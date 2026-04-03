import { useEffect, useMemo, useState } from "react";
import mqtt from "mqtt";

type DeviceStatus = "online" | "offline" | "unknown";
type DeviceCategory = "facility" | "production" | "unknown";

type RawData = Record<string, unknown>;

type DeviceHistoryEntry = {
  fm: string;
  date: string;
};

interface DeviceInfo {
  deviceId: string;
  status: DeviceStatus;
  category: DeviceCategory;
  machineType: string;
  nodeId?: string;
  rawData: RawData;
  updatedAt: string;
  history: DeviceHistoryEntry[];
}

const DEFAULT_BROKER = "ws://192.168.110.2:8083/mqtt";

function parseDeviceId(id: string): { category: DeviceCategory; machineType: string } {
  if (!id) return { category: "unknown", machineType: "unknown" };
  const parts = id.split("_");
  if (parts.length < 2) return { category: "unknown", machineType: "unknown" };

  const categoryIndex = parts.findIndex((part, index) =>
    index > 0 && /facility|production/i.test(part)
  );
  const category: DeviceCategory = categoryIndex >= 0
    ? (parts[categoryIndex].toLowerCase().includes("facility") ? "facility" : "production")
    : "unknown";

  const lastPart = parts[parts.length - 1];
  const isMac = /^[0-9A-Fa-f]{12}$/.test(lastPart);
  let machineType = "unknown";

  if (categoryIndex >= 0) {
    const endIndex = isMac ? parts.length - 1 : parts.length;
    machineType = parts.slice(categoryIndex + 1, endIndex).join("_").toLowerCase() || "unknown";
  } else if (isMac && parts.length >= 4) {
    machineType = parts.slice(2, parts.length - 1).join("_").toLowerCase();
  } else if (parts.length >= 3) {
    machineType = parts.slice(2).join("_").toLowerCase();
  } else if (parts.length === 2) {
    machineType = "default";
  }

  return { category, machineType };
}

function parseClientId(clientId: string): { deviceId: string; category: DeviceCategory; machineType: string; nodeId?: string } {
  const parts = clientId.split("_");
  const nodeId = parts.length > 3 && /^[0-9A-Fa-f]{12}$/.test(parts[parts.length - 1])
    ? parts[parts.length - 1]
    : undefined;
  const deviceId = parts[0] || "unknown";
  let category: DeviceCategory = "unknown";
  let machineType = "unknown";

  const categoryIndex = parts.findIndex((part, index) => index > 0 && /facility|production/i.test(part));
  if (categoryIndex >= 0) {
    category = parts[categoryIndex].toLowerCase().includes("facility") ? "facility" : "production";
    const endIndex = nodeId ? parts.length - 1 : parts.length;
    machineType = parts.slice(categoryIndex + 1, endIndex).join("_").toLowerCase() || "unknown";
    return { deviceId, category, machineType, nodeId };
  }

  const fallback = parseDeviceId(clientId);
  return { deviceId, category: fallback.category, machineType: fallback.machineType, nodeId };
}

function normalizePayload(raw: RawData): DeviceInfo {
  const rawClientId = raw.client_id as string | undefined;
  const rawDeviceId = (raw.device_id as string) || rawClientId || "unknown";
  const status =
    (raw.status as DeviceStatus) ||
    ((raw.event as string) === "client.connected" ? "online" : undefined) ||
    ((raw.event as string) === "client.disconnected" ? "offline" : undefined) ||
    "unknown";

  const parsed = rawClientId ? parseClientId(rawClientId) : { deviceId: rawDeviceId, ...parseDeviceId(rawDeviceId) };
  return {
    deviceId: parsed.deviceId,
    status,
    category: parsed.category,
    machineType: parsed.machineType,
    nodeId: parsed.nodeId,
    rawData: raw,
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

function parseHistoryEntry(raw: RawData): DeviceHistoryEntry | null {
  const fmValue = raw.fm ?? raw.FM ?? raw.Fm ?? raw.fault_mode ?? raw.faultMode;
  if (!fmValue) return null;
  const dateValue = raw.date ?? raw.timestamp ?? raw.ts ?? raw.time ?? raw.time_stamp;
  const dateString = dateValue ? String(dateValue) : new Date().toISOString();
  return {
    fm: String(fmValue),
    date: dateString,
  };
}

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const statusLabel = (status: DeviceStatus) =>
  status === "online" ? "Online" : status === "offline" ? "Offline" : "Unknown";

const categoryChipClass = (category: DeviceCategory) => {
  if (category === "facility") return "meta-chip category-facility";
  if (category === "production") return "meta-chip category-production";
  return "meta-chip category-unknown";
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));

function App() {
  const [devices, setDevices] = useState<Record<string, DeviceInfo>>({});
  const [statusFilter, setStatusFilter] = useState<"all" | DeviceStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | DeviceCategory>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("Connecting...");
  const [connectionState, setConnectionState] = useState("idle");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, feedbackKey: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Ngăn việc mở modal

    const showFeedback = () => {
      setCopiedId(feedbackKey);
      setTimeout(() => setCopiedId(null), 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      // Use modern Clipboard API if available (Requires HTTPS)
      navigator.clipboard.writeText(text).then(showFeedback).catch(err => {
        console.error("Clipboard copy failed", err);
      });
    } else {
      // Fallback for insecure contexts (HTTP) or older browsers
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        showFeedback();
      } catch (err) {
        console.error("Fallback copy failed", err);
      }
    }
  };

  const resetFilters = () => {
    setStatusFilter("all");
    setCategoryFilter("all");
    setMachineFilter("all");
    setSearch("");
  };

  useEffect(() => {
    const client = mqtt.connect(DEFAULT_BROKER, {
      username: "devicemqtt",
      password: "37X9AMn9",
      reconnectPeriod: 3000,
    });

    client.on("connect", () => {
      setConnectionState("connected");
      setConnectionLabel("Online");
      client.subscribe("event/status/#");
    });

    client.on("error", () => {
      setConnectionState("error");
      setConnectionLabel("Connection error");
    });

    client.on("offline", () => {
      setConnectionState("offline");
      setConnectionLabel("Disconnected");
    });

    client.on("reconnect", () => {
      setConnectionState("reconnect");
      setConnectionLabel("Reconnecting...");
    });

    client.on("message", (_, message) => {
      try {
        const raw = JSON.parse(message.toString()) as RawData;
        const next = normalizePayload(raw);
        const historyEntry = parseHistoryEntry(raw);
        setDevices((current) => {
          const existing = current[next.deviceId];
          const existingHistory = existing?.history ?? [];
          const history = historyEntry
            ? [historyEntry, ...existingHistory].slice(0, 100)
            : existingHistory;
          return {
            ...current,
            [next.deviceId]: {
              ...next,
              history,
            },
          };
        });
      } catch (error) {
        console.warn("Parse error:", error);
      }
    });

    return () => {
      client.end(true);
    };
  }, []);

  const allDevices = useMemo(() => Object.values(devices), [devices]);

  const onlineCount = useMemo(
    () => allDevices.filter((device) => device.status === "online").length,
    [allDevices]
  );
  const offlineCount = useMemo(
    () => allDevices.filter((device) => device.status === "offline").length,
    [allDevices]
  );
  const facilityCount = useMemo(
    () => allDevices.filter((device) => device.category === "facility").length,
    [allDevices]
  );
  const productionCount = useMemo(
    () => allDevices.filter((device) => device.category === "production").length,
    [allDevices]
  );

  const categoryScoped = useMemo(
    () =>
      categoryFilter === "all"
        ? allDevices
        : allDevices.filter((device) => device.category === categoryFilter),
    [allDevices, categoryFilter]
  );

  const machineTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    categoryScoped.forEach((device) => {
      if (!device.machineType || device.machineType === "unknown") return;
      counts[device.machineType] = (counts[device.machineType] || 0) + 1;
    });
    return Object.keys(counts).sort();
  }, [categoryScoped]);

  useEffect(() => {
    if (machineFilter !== "all" && !machineTypes.includes(machineFilter)) {
      setMachineFilter("all");
    }
  }, [machineFilter, machineTypes]);

  const machineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    categoryScoped.forEach((device) => {
      counts[device.machineType] = (counts[device.machineType] || 0) + 1;
    });
    return counts;
  }, [categoryScoped]);

  const query = search.trim().toLowerCase();
  const filteredDevices = useMemo(
    () =>
      allDevices.filter((device) => {
        if (statusFilter !== "all" && device.status !== statusFilter) return false;
        if (categoryFilter !== "all" && device.category !== categoryFilter) return false;
        if (machineFilter !== "all" && device.machineType !== machineFilter) return false;
        if (query) {
          const deviceMatch = device.deviceId.toLowerCase().includes(query);
          const payloadMatch = Object.values(device.rawData).some((value) =>
            String(value).toLowerCase().includes(query)
          );
          if (!deviceMatch && !payloadMatch) return false;
        }
        return true;
      }),
    [allDevices, statusFilter, categoryFilter, machineFilter, query]
  );

  const formatMacAddress = (val: unknown) => {
    const str = String(val);
    if (str.length === 12 && /^[0-9A-Fa-f]{12}$/.test(str)) {
      return str.toUpperCase().match(/.{1,2}/g)?.join(":") || str;
    }
    return formatValue(val);
  };

  const payloadKeys = useMemo(() => {
    const excluded = new Set(["device_id", "status", "client_id", "ms", "system", "type", "ip"]);
    const keys = new Set<string>();
    filteredDevices.forEach((device) => {
      Object.keys(device.rawData).forEach((key) => {
        if (!excluded.has(key.toLowerCase())) {
          keys.add(key);
        }
      });
    });
    return [...keys].sort();
  }, [filteredDevices]);

  const statusPriority: Record<DeviceStatus, number> = {
    offline: 0,
    online: 1,
    unknown: 2,
  };

  const sortedDevices = useMemo(
    () =>
      [...filteredDevices].sort((a, b) => {
        const diff = statusPriority[a.status] - statusPriority[b.status];
        if (diff !== 0) return diff;
        return a.deviceId.localeCompare(b.deviceId);
      }),
    [filteredDevices]
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src="/logo.png" alt="Logo" className="brand-logo" style={{ height: "45px", width: "auto" }} />
          <div className="brand-text" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap:'3px' }}>
            <h1 style={{ fontSize: "1.7rem", margin: 0, lineHeight: 1 }}>AIOT</h1>
            <p style={{ fontSize: "0.9rem", margin: 0, opacity: 0.8 }}>Real-time Machine & Utility Tracking</p>
          </div>
        </div>

        <div className="topbar-center">
          <div className="stat-pills">
            <div className="stat-pill" style={{ padding: "10px 20px", borderRadius: "12px", gap: "10px" }}>
              <span className="dot" style={{ background: "var(--online)", width: "12px", height: "12px" }} />
              <span style={{ fontSize: "1.8rem", fontWeight: "bold", lineHeight: 1 }}>{onlineCount}</span>
              <span style={{ fontSize: "1.5rem", textTransform: "capitalize" }}>online</span>
            </div>
            <div className="stat-pill" style={{ padding: "10px 20px", borderRadius: "12px", gap: "10px" }}>
              <span className="dot" style={{ background: "var(--offline)", width: "12px", height: "12px" }} />
              <span style={{ fontSize: "1.8rem", fontWeight: "bold", lineHeight: 1 }}>{offlineCount}</span>
              <span style={{ fontSize: "1.5rem", textTransform: "capitalize" }}>offline</span>
            </div>
            <div className="stat-pill" style={{ padding: "10px 20px", borderRadius: "12px", gap: "10px" }}>
              <span className="dot" style={{ background: "var(--muted-2)", width: "12px", height: "12px" }} />
              <span style={{ fontSize: "1.8rem", fontWeight: "bold", lineHeight: 1 }}>{allDevices.length}</span>
              <span style={{ fontSize: "1.5rem", textTransform: "capitalize" }}>total</span>
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <div className="mqtt-chip">
            <span className={`mqtt-dot ${connectionState === "connected" ? "connected" : (connectionState === "error" || connectionState === "offline" ? "error" : "")}`} />
            <span style={{ fontWeight: 600 }}>{connectionLabel}</span>
          </div>
        </div>
      </header>

      

      <section className="filters compact-filters"  style={{
    position: "sticky",
    top: '80px',
    zIndex: 1000
  }}>
        <div className="compact-row">
            
          <div className="search-wrap compact" style={{ position: "relative", display: "flex", alignItems: "bottom" }}>
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              style={{ position: "absolute", left: "25px", width: "16px", height: "16px", pointerEvents: "none", opacity: 0.6 }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              id="search-input"
              type="text"
              placeholder="Search device"
              style={{ paddingLeft: "32px", width: "100%" }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="select-group">
            <label className="filter-label" htmlFor="status-select">Status</label>
            <select
              id="status-select"
              className="filter-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | DeviceStatus)}
            >
              <option value="all">All </option>
              <option value="online">Online</option>
              <option value="offline">Offline </option>
            </select>
          </div>
          <div className="select-group">
            <label className="filter-label" htmlFor="category-select">Category</label>
            <select
              id="category-select"
              className="filter-select"
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value as "all" | DeviceCategory);
                setMachineFilter("all");
              }}
            >
              <option value="all">All </option>
              <option value="facility">Facility </option>
              <option value="production">Production </option>
            </select>
          </div>
          <div className="select-group">
            <label className="filter-label" htmlFor="machine-select">Machine Type</label>
            <select
              id="machine-select"
              className="filter-select"
              value={machineFilter}
              onChange={(event) => setMachineFilter(event.target.value)}
            >
              <option value="all">All </option>
              {machineTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <button className="btn ghost compact-reset" type="button" onClick={resetFilters}>
            Reset
          </button>
           <div className="toolbar-meta compact-meta">
          {allDevices.length === 0
            ? "Waiting for data..."
            : `Showing ${filteredDevices.length} of ${allDevices.length} devices`}
        </div>
        </div>
       
      </section>

      <div className="table-wrap" id="grid">
        {filteredDevices.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8m-4-4v4" />
              </svg>
            </div>
            <h3>{allDevices.length === 0 ? "Waiting for MQTT data" : "No devices found"}</h3>
            <p>
              {allDevices.length === 0
                ? "The dashboard will automatically update when data is received from the MQTT broker."
                : "Try adjusting filters or search terms."}
            </p>
          </div>
        ) : (
          <table className="device-table">
            <thead>
              <tr>
                <th style={{textAlign:'center'}}>Device ID</th>
                <th style={{textAlign:'center'}}>Status</th>
                <th style={{textAlign:'center'}}>Category</th>
                <th style={{textAlign:'center'}}>Machine Type</th>
                {payloadKeys.length > 0 ? (
                  payloadKeys.map((key) => (
                    <th  key={key}
                     style={key.toLowerCase() === "node_id" ? { position: 'relative', textAlign: 'center' } : {}}
                    >
                      {key.toLowerCase() === "node_id" 
                        ? "Node ID / MAC" 
                        : key.toLowerCase() === "fw" 
                          ? "Firmware" 
                          : key}
                    </th>
                  ))
                ) : (
                  <th>Payload</th>
                )}
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {sortedDevices.map((device) => (
                <tr
                  key={device.deviceId}
                  className="device-row"
                  
                >
                  <td 
                    className="device-id" 
                    style={{textAlign:'center', position: 'relative'}}
                    onClick={(e) => handleCopy(device.deviceId, device.deviceId, e)}
                    title="Click to copy ID"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {device.deviceId}
                      <svg 
                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" 
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" 
                        style={{ marginLeft: '6px', opacity: 0.4, flexShrink: 0 }}
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </span>
                    {copiedId === device.deviceId && <span className="copy-feedback">Copied!</span>}
                  </td>
                  <td style={{textAlign:'center'}}>
                    <span className={`status-badge ${device.status === "online" ? "status-online" : device.status === "offline" ? "status-offline" : "status-unknown"}`}>
                      <span  className="bdot" />
                      {statusLabel(device.status)}
                    </span>
                  </td>
                  <td style={{textAlign:'center'}}>
                    <span style={{textAlign:'center'}} className={categoryChipClass(device.category)}>{device.category}</span>
                  </td>
                  <td style={{textAlign:'center'}}>
                    <span style={{textAlign:'center'}} className="meta-chip mtype">{device.machineType.replace(/_/g, " ")}</span>
                  </td>
                  {payloadKeys.length > 0 ? (
                    payloadKeys.map((key) => {
                      const isNodeId = key.toLowerCase() === "node_id";
                      const val = device.rawData[key];
                      const feedbackKey = `${device.deviceId}-${key}`;
                      return (
                        <td 
                          key={key} 
                          className={isNodeId ? "device-id" : ""}
                          style={isNodeId ? { position: 'relative', textAlign: 'center'} : {}}
                          onClick={isNodeId ? (e) => handleCopy(formatMacAddress(val), feedbackKey, e) : undefined}
                        >
                          {isNodeId ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {formatMacAddress(val)}
                              <svg 
                                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" 
                                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" 
                                style={{ marginLeft: '6px', opacity: 0.4, flexShrink: 0 }}
                              >
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </span>
                          ) : (
                            formatValue(val)
                          )}
                          {isNodeId && copiedId === feedbackKey && <span className="copy-feedback">Copied!</span>}
                        </td>
                      );
                    })
                  ) : (
                    <td>-</td>
                  )}
                  <td>{formatTime(device.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      
    </div>
  );
}

export default App;
