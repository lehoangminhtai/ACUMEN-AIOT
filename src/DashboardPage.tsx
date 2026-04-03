import React, { useEffect, useMemo, useState } from "react";
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
            <span className="dot" style={{ background: slice.color }}></span>
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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return "just now";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "under 1m";
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
        <div className="db-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Real-time Events
          </h3>
          <div className="realtime-list">
            {realtimeEvents.length === 0 ? (
              <div className="realtime-empty">No events yet.</div>
            ) : (
              realtimeEvents.map((ev, idx) => (
                <div key={ev.id} className={`realtime-item ${idx === 0 ? "is-new" : ""}`}>
                  <div className="rt-head">
                    <span className="rt-device">{ev.deviceId}</span>
                    <span className="rt-time">{new Date(ev.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="rt-label">{ev.label}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="db-card">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            Machine Type Distribution
          </h3>
          <div style={{ marginTop: "10px" }}>
            {Object.entries(machineCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div key={type} className="dist-item">
                  <div className="dist-info">
                    <span style={{ textTransform: "capitalize" }}>{type.replace(/_/g, " ")}</span>
                    <span style={{ fontWeight: 700 }}>{count}</span>
                  </div>
                  <div className="dist-bar-bg">
                    <div className="dist-bar-fill" style={{ width: `${(count / (stats.total || 1)) * 100}%` }} />
                  </div>
                </div>
              ))}
          </div>
          {topMachine && (
            <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--muted)" }}>
              Top: {topMachine.type.replace(/_/g, " ")} ({topMachine.count})
            </div>
          )}
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
      </div>
    </div>
  );
};
