import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./DashboardPage.css";

interface DashboardPageProps {
  allDevices: any[];
  machineCounts: Record<string, number>;
  stats: {
    online: number;
    offline: number;
    total: number;
  };
}

type DbOfflineDevice = {
  deviceId: string;
  nodeId: string;
  offlineDurationSec: number;
  offlineText: string;
  lastOfflineAt: string;
  lastOnlineAt: string;
  updatedAt: string;
};

const toCamel = (raw: string) => {
  const parts = raw.replace(/_/g, " ").trim().split(/\s+/);
  if (parts.length === 0) return "";
  return parts
    .map((p, i) =>
      i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    )
    .join("");
};

const SimplePieChart = ({ data }: { data: { label: string; value: number; color: string }[] }) => {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent: number) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  if (total === 0) return <div className="pie-empty">No Data</div>;

  return (
    <div className="pie-container">
      <svg viewBox="-1 -1 2 2" style={{ transform: "rotate(-90deg)", width: "150px", height: "150px" }}>
        {data.map((slice, i) => {
          const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
          cumulativePercent += slice.value / total;
          const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
          const largeArcFlag = slice.value / total > 0.5 ? 1 : 0;
          const pathData = [`M ${startX} ${startY}`, `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`, `L 0 0`].join(" ");
          return <path key={i} d={pathData} fill={slice.color} />;
        })}
      </svg>
      <div className="pie-legend">
        {data.map((slice, i) => (
          <div key={i} className="legend-item">
            <span className="legend-dot" style={{ background: slice.color }}></span>
            <span className="label">
              {slice.label}: {slice.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DashboardPage: React.FC<DashboardPageProps> = ({ allDevices, machineCounts, stats }) => {
  const [now, setNow] = useState(() => Date.now());

  const phpEndpoint =
    (import.meta as any).env?.VITE_PHP_DASHBOARD_URL || "/device_status_dashboard.php";

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return "just now";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "< 1m";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const offlineDevices = useMemo(() => {
    return allDevices
      .filter((d) => d.status === "offline")
      .map((d) => {
        const offlineMs = Math.max(0, now - new Date(d.updatedAt).getTime());
        return { ...d, offlineMs };
      })
      .sort((a, b) => b.offlineMs - a.offlineMs);
  }, [allDevices, now]);

  const categoryData = useMemo(
    () => [
      { label: "Production", value: allDevices.filter((d) => d.category === "production").length, color: "#b45309" },
      { label: "Facility", value: allDevices.filter((d) => d.category === "facility").length, color: "#7c3aed" },
    ],
    [allDevices]
  );

  const machineTypeStats = useMemo(() => {
    const map: Record<string, { online: number; offline: number; production: number; facility: number }> = {};
    allDevices.forEach((d) => {
      const key = d.machineType || "unknown";
      if (!map[key]) map[key] = { online: 0, offline: 0, production: 0, facility: 0 };
      if (d.status === "online") map[key].online += 1;
      else if (d.status === "offline") map[key].offline += 1;
      if (d.category === "production") map[key].production += 1;
      else if (d.category === "facility") map[key].facility += 1;
    });
    return map;
  }, [allDevices]);

  const statusData = useMemo(
    () => [
      { label: "Online", value: stats.online, color: "var(--online)" },
      { label: "Offline", value: stats.offline, color: "var(--offline)" },
    ],
    [stats]
  );

  const realtimeEvents = useMemo(() => {
    const events: { id: string; deviceId: string; label: string; ts: number }[] = [];
    allDevices.forEach((d) => {
      (d.history ?? []).forEach((ev: any, idx: number) => {
        const ts = Date.parse(ev.date as string) || Date.now();
        events.push({
          id: `${d.deviceId}-${idx}-${ev.date}`,
          deviceId: d.deviceId,
          label: ev.fm,
          ts,
        });
      });
    });
    return events.sort((a, b) => b.ts - a.ts).slice(0, 40);
  }, [allDevices]);

  const staleThresholdMs = 30 * 60 * 1000;
  const staleCount = useMemo(
    () => allDevices.filter((d) => now - new Date(d.updatedAt).getTime() > staleThresholdMs).length,
    [allDevices, now]
  );
  const longestOfflineMs = offlineDevices[0]?.offlineMs ?? 0;
  const topMachine = useMemo(() => {
    const sorted = Object.entries(machineCounts).sort((a, b) => b[1] - a[1]);
    return sorted[0] ? { type: sorted[0][0], count: sorted[0][1] } : null;
  }, [machineCounts]);

  const transitionStats = useMemo(() => {
    const latest = realtimeEvents.slice(0, 30);
    let toOffline = 0;
    let toOnline = 0;
    latest.forEach((e) => {
      const text = e.label?.toLowerCase?.() || "";
      if (text.includes("offline") || text.includes("disconnected")) toOffline += 1;
      if (text.includes("online") || text.includes("connected")) toOnline += 1;
    });
    const total = Math.max(1, toOffline + toOnline);
    return {
      toOffline,
      toOnline,
      offPct: Math.round((toOffline / total) * 100),
      onPct: Math.round((toOnline / total) * 100),
    };
  }, [realtimeEvents]);

  const flappingDevices = useMemo(() => {
    const latest = realtimeEvents.slice(0, 80);
    const map = new Map<
      string,
      { flips: number; last: string | null; firstTs: number; lastTs: number }
    >();

    const labelToState = (label: string) => {
      const l = label.toLowerCase();
      if (l.includes("online") || l.includes("connected")) return "online";
      if (l.includes("offline") || l.includes("disconnected")) return "offline";
      return "other";
    };

    latest.forEach((e) => {
      const state = labelToState(e.label || "");
      if (state === "other") return;
      const entry = map.get(e.deviceId) ?? { flips: 0, last: null, firstTs: e.ts, lastTs: e.ts };
      if (entry.last && entry.last !== state) entry.flips += 1;
      entry.last = state;
      entry.lastTs = Math.max(entry.lastTs, e.ts);
      map.set(e.deviceId, entry);
    });

    const arr = Array.from(map.entries())
      .map(([deviceId, info]) => ({ deviceId, ...info }))
      .filter((d) => d.flips > 0)
      .sort((a, b) => b.flips - a.flips || b.lastTs - a.lastTs)
      .slice(0, 8);

    const maxFlips = Math.max(1, ...arr.map((d) => d.flips));
    return { list: arr, maxFlips };
  }, [realtimeEvents]);

  // --- Long-term offline from PHP dashboard (DB) ---
  const [dbOffline, setDbOffline] = useState<DbOfflineDevice[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const fetchDb = useCallback(async () => {
    const parseDuration = (text: string) => {
      const parts = text.split(/\s+/).filter(Boolean);
      let total = 0;
      parts.forEach((p) => {
        const num = parseInt(p, 10);
        if (Number.isNaN(num)) return;
        if (p.includes("d")) total += num * 86400;
        else if (p.includes("h")) total += num * 3600;
        else if (p.includes("m")) total += num * 60;
        else if (p.includes("s")) total += num;
      });
      return total;
    };

    try {
      setDbLoading(true);
      setDbError(null);
      const res = await fetch(phpEndpoint, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const rows = Array.from(doc.querySelectorAll("table tbody tr"));
      const devices: DbOfflineDevice[] = [];
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 11) return;
        const statusBadge = cells[3]?.textContent?.trim().toLowerCase();
        if (statusBadge !== "offline") return;
        const offlineText = cells[10]?.textContent?.trim() || "-";
        const offlineSec = parseDuration(offlineText);
        if (offlineSec < 3600) return; // only long-term
        devices.push({
          deviceId: cells[1]?.textContent?.trim() || "",
          nodeId: cells[2]?.textContent?.trim() || "",
          offlineDurationSec: offlineSec,
          offlineText,
          lastOfflineAt: cells[9]?.textContent?.trim() || "",
          lastOnlineAt: cells[8]?.textContent?.trim() || "",
          updatedAt: cells[7]?.textContent?.trim() || "",
        });
      });
      devices.sort((a, b) => b.offlineDurationSec - a.offlineDurationSec);
      setDbOffline(devices.slice(0, 20));
    } catch (err: any) {
      console.error("DB offline fetch error", err);
      setDbError(err?.message ?? "Cannot load DB offline list");
    } finally {
      setDbLoading(false);
    }
  }, [phpEndpoint]);

  useEffect(() => {
    fetchDb();
    const id = setInterval(fetchDb, 120_000); // refresh every 2 minutes
    return () => clearInterval(id);
  }, [fetchDb]);

  return (
    <div className="dashboard-page">
      {/* Summary Cards */}
      <div className="dashboard-grid">
        <div className="db-card">
          <div style={{ color: "var(--muted)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>System Availability</div>
          <div style={{ fontSize: "32px", fontWeight: 800, color: "var(--online)", marginTop: "8px" }}>
            {stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0}%
          </div>
          <div style={{ fontSize: "13px", color: "var(--muted-2)", marginTop: "4px" }}>
            {stats.online} of {stats.total} devices online
          </div>
        </div>
        <div className="db-card">
          <div style={{ color: "var(--muted)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>Stale devices (&gt;30m)</div>
          <div style={{ fontSize: "32px", fontWeight: 800, marginTop: "8px", color: staleCount > 0 ? "var(--offline)" : "var(--text)" }}>{staleCount}</div>
          <div style={{ fontSize: "13px", color: "var(--muted-2)", marginTop: "4px" }}>No update received over 30 minutes</div>
        </div>
        <div className="db-card">
          <div style={{ color: "var(--muted)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>Longest offline</div>
          <div style={{ fontSize: "32px", fontWeight: 800, color: stats.offline > 0 ? "var(--offline)" : "var(--text)", marginTop: "8px" }}>
            {longestOfflineMs === 0 ? "—" : formatDuration(longestOfflineMs)}
          </div>
          <div style={{ fontSize: "13px", color: "var(--muted-2)", marginTop: "4px" }}>Based on device updatedAt</div>
        </div>
        <div className="db-card">
          <div style={{ color: "var(--muted)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>DB long-term offline (&gt;1h)</div>
          <div style={{ fontSize: "32px", fontWeight: 800, color: dbOffline.length > 0 ? "var(--offline)" : "var(--text)", marginTop: "8px" }}>
            {dbOffline.length}
          </div>
          <div style={{ fontSize: "13px", color: "var(--muted-2)", marginTop: "4px" }}>Fetched from device_status_dashboard.php</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="db-card offline-list-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3h18v18H3z" />
              <path d="M3 9h18" />
            </svg>
            Offline devices
          </h3>
          <div className="offline-scroll-area">
            {offlineDevices.length === 0 ? (
              <div className="realtime-empty">No offline devices</div>
            ) : (
              <div className="offline-grid">
                {offlineDevices.map((d) => (
                  <div key={d.deviceId} className="offline-item">
                    <span className="off-id">{d.deviceId}</span>
                    <span className="off-time">Offline for: {formatDuration(d.offlineMs)}</span>
                    <span className="off-time">Last update: {new Date(d.updatedAt).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="db-card offline-list-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3h18v18H3z" />
              <path d="M3 9h18" />
            </svg>
            Long-term Offline (DB)
          </h3>
          <div className="db-meta-row">
           
            <button className="mini-btn" type="button" onClick={fetchDb}>Reload</button>
          </div>
          <div className="offline-scroll-area">
            {dbLoading ? (
              <div className="realtime-empty">Loading from DB...</div>
            ) : dbError ? (
              <div className="realtime-empty">Error: {dbError}</div>
            ) : dbOffline.length === 0 ? (
              <div className="realtime-empty">No devices offline &gt;1h in DB</div>
            ) : (
              <div className="offline-grid">
                {dbOffline.map((d) => (
                  <div key={d.deviceId} className="offline-item">
                    <span className="off-id">{d.deviceId}</span>
                    <span className="off-time">Offline: {d.offlineText}</span>
                    <span className="off-time">Last offline: {d.lastOfflineAt}</span>
                    <span className="off-time">DB updated: {d.updatedAt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="db-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            Connection Status
          </h3>
          <SimplePieChart data={statusData} />
        </div>
        <div className="db-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2v20M2 12h20" />
            </svg>
            Category Distribution
          </h3>
          <SimplePieChart data={categoryData} />
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="db-card rt-card">
          <div className="rt-header">
            <div className="rt-title">
              <span className="live-dot" /> Live Events
            </div>
          </div>
          <div className="rt-list">
            {realtimeEvents.length === 0 ? (
              <div className="realtime-empty">No events yet.</div>
            ) : (
              realtimeEvents.map((ev, idx) => (
                <div key={ev.id} className="rt-row">
                  <span className={`rt-dot ${idx === 0 ? "rt-dot-live" : ""}`} />
                  <div className="rt-body">
                    <div className="rt-top">
                      <span className="rt-device">{ev.deviceId}</span>
                      <span className="rt-time">{new Date(ev.ts).toLocaleTimeString()}</span>
                    </div>
                    <div className="rt-bottom">{ev.label}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>


        <div className="db-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h4l2 4 3-6 3 6 2-4h2" />
            </svg>
            Flapping Devices
          </h3>
          {flappingDevices.list.length === 0 ? (
            <div className="realtime-empty">No recent status flips detected.</div>
          ) : (
            <div className="flap-list">
              {flappingDevices.list.map((d) => (
                <div key={d.deviceId} className="flap-row">
                  <div className="flap-meta">
                    <span className="flap-id">{d.deviceId}</span>
                    <span className="flap-count">{d.flips} flips</span>
                  </div>
                  <div className="flap-bar">
                    <div
                      className="flap-fill"
                      style={{ width: `${(d.flips / flappingDevices.maxFlips) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="db-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            Machine Type Distribution
          </h3>
          <div style={{ marginTop: "10px" }}>
            {Object.entries(machineTypeStats)
              .sort((a, b) => (b[1].offline + b[1].online) - (a[1].offline + a[1].online))
              .map(([type, counts]) => {
                const total = counts.offline + counts.online || 1;
                const offPct = (counts.offline / total) * 100;
                const onPct = (counts.online / total) * 100;
                const categoryLabel =
                  counts.production === counts.facility
                    ? "Mixed"
                    : counts.production > counts.facility
                    ? "Production"
                    : "Facility";
                const displayName = `${type.replace(/_/g, " ")} (${categoryLabel})`;
                return (
                  <div key={type} className="dist-item">
                    <div className="dist-info">
                      <span style={{ fontWeight: 700, color: "var(--offline)" }}>{counts.offline}</span>
                      <span style={{textTransform:'capitalize'}}>{displayName}</span>
                      <span style={{ fontWeight: 700, color: "var(--online)" }}>{counts.online}</span>
                    </div>
                    <div className="dist-bar-bg dual">
                      <div className="dist-bar-fill off" style={{ width: `${offPct}%` }} />
                      <div className="dist-bar-fill on" style={{ width: `${onPct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
          
        </div>
      </div>
    </div>
  );
};
