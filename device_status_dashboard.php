<?php
declare(strict_types=1);

/**
 * Device Status Dashboard (English)
 */

$config = require __DIR__ . '/config.php';

if (!is_array($config) || !isset($config['db'])) {
    die('Invalid config.php');
}

date_default_timezone_set($config['timezone'] ?? 'Asia/Ho_Chi_Minh');

$db = $config['db'];

$dsn = sprintf(
    "mysql:host=%s;port=%d;dbname=%s;charset=%s",
    $db['host'],
    $db['port'],
    $db['name'],
    $db['charset']
);

try {
    $pdo = new PDO($dsn, $db['user'], $db['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Throwable $e) {
    die('DB connection failed: ' . $e->getMessage());
}

$sql = "
SELECT
    device_id,
    node_id,
    status,
    fw,
    ms,
    updated_at,
    datetime,
    last_online_at,
    last_offline_at,
    CASE
        WHEN status = 'offline' AND last_offline_at IS NOT NULL
        THEN TIMESTAMPDIFF(SECOND, last_offline_at, NOW())
        ELSE 0
    END AS offline_sec
FROM device_status
ORDER BY
    CASE WHEN status = 'online' THEN 0 ELSE 1 END,
    device_id ASC
";

$rows = $pdo->query($sql)->fetchAll();

function h($v) {
    return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
}

function formatDuration($sec) {
    if ($sec <= 0) return '-';

    $d = intdiv($sec, 86400); $sec %= 86400;
    $h = intdiv($sec, 3600);  $sec %= 3600;
    $m = intdiv($sec, 60);    $sec %= 60;

    $out = [];
    if ($d) $out[] = $d . 'd';
    if ($h) $out[] = $h . 'h';
    if ($m) $out[] = $m . 'm';
    if ($sec && !$d) $out[] = $sec . 's';

    return implode(' ', $out);
}

$total = count($rows);
$online = 0;
$offline = 0;
$offlineWarn = 0;

foreach ($rows as $r) {
    if ($r['status'] === 'online') {
        $online++;
    } else {
        $offline++;
        if ((int)$r['offline_sec'] >= 3600) {
            $offlineWarn++;
        }
    }
}

$site = $config['site_name'] ?? 'Device Monitor';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= h($site) ?> - Device Status</title>

<style>
body {
    margin:0; padding:24px;
    font-family:Arial;
    background:#f5f7fb;
}
.container { max-width:1600px; margin:auto; }

h1 { margin-bottom:6px; }
.subtitle { color:#666; margin-bottom:20px; }

.summary {
    display:flex; gap:12px; flex-wrap:wrap;
    margin-bottom:20px;
}

.card {
    background:#fff;
    padding:16px;
    border-radius:10px;
    min-width:180px;
    box-shadow:0 2px 8px rgba(0,0,0,0.05);
}

.card .value {
    font-size:26px;
    font-weight:bold;
}

.table-wrap {
    background:#fff;
    border-radius:10px;
    overflow:auto;
}

table {
    width:100%;
    border-collapse:collapse;
    min-width:1300px;
}

th {
    background:#111;
    color:#fff;
    padding:12px;
    text-align:left;
}

td {
    padding:10px;
    border-bottom:1px solid #eee;
}

.badge {
    padding:5px 10px;
    border-radius:999px;
    font-size:12px;
    font-weight:bold;
}

.online {
    background:#dcfce7;
    color:#166534;
}

.offline {
    background:#e5e7eb;
    color:#374151;
}

.danger {
    color:#b91c1c;
    font-weight:bold;
}

.mono { font-family:monospace; }
.right { text-align:right; }
</style>

<meta http-equiv="refresh" content="60">
</head>

<body>
<div class="container">

<h1>Device Status Dashboard</h1>
<div class="subtitle"><?= h($site) ?></div>

<div class="summary">
    <div class="card">
        <div>Total Devices</div>
        <div class="value"><?= $total ?></div>
    </div>
    <div class="card">
        <div>Online</div>
        <div class="value" style="color:green"><?= $online ?></div>
    </div>
    <div class="card">
        <div>Offline</div>
        <div class="value"><?= $offline ?></div>
    </div>
    <div class="card">
        <div>Offline > 1h</div>
        <div class="value" style="color:red"><?= $offlineWarn ?></div>
    </div>
</div>

<div style="margin-bottom:10px;color:#666;">
Auto refresh every 60 seconds | Now: <?= date('Y-m-d H:i:s') ?>
</div>

<div class="table-wrap">
<table>
<thead>
<tr>
<th>#</th>
<th>Device ID</th>
<th>Node ID</th>
<th>Status</th>
<th>FW</th>
<th class="right">ms</th>
<th>Event Time</th>
<th>DB Updated</th>
<th>Last Online</th>
<th>Last Offline</th>
<th>Offline Duration</th>
</tr>
</thead>

<tbody>
<?php foreach ($rows as $i => $r): 
    $offlineSec = (int)$r['offline_sec'];
    $warn = ($r['status']=='offline' && $offlineSec>=3600);
?>
<tr>
<td><?= $i+1 ?></td>
<td class="mono"><?= h($r['device_id']) ?></td>
<td class="mono"><?= h($r['node_id']) ?></td>
<td>
<?php if ($r['status']=='online'): ?>
<span class="badge online">ONLINE</span>
<?php else: ?>
<span class="badge offline">OFFLINE</span>
<?php endif; ?>
</td>
<td><?= h($r['fw']) ?></td>
<td class="right mono"><?= h($r['ms']) ?></td>
<td class="mono"><?= h($r['datetime']) ?></td>
<td class="mono"><?= h($r['updated_at']) ?></td>
<td class="mono"><?= h($r['last_online_at']) ?></td>
<td class="mono"><?= h($r['last_offline_at']) ?></td>
<td class="<?= $warn ? 'danger':'' ?>">
<?= $r['status']=='offline' ? formatDuration($offlineSec) : '-' ?>
</td>
</tr>
<?php endforeach; ?>
</tbody>
</table>
</div>

</div>
</body>
</html>