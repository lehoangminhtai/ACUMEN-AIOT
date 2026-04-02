<?php
// config.php
return [
  // ===== DB =====
  'db' => [
    'host' => 'localhost',
    'port' => 3306,
    'name' => 'mqtt',
    'user' => 'device',
    'pass' => 'BtyLX96qZ4nDL!0w',
    'charset' => 'utf8mb4',
  ],

  // ===== Discord =====
  'discord' => [
    'webhook_url' => 'https://discord.com/api/webhooks/1471349436587315230/xtNZmzxcvzDpS9FPhwUszwpcj7qkI9ULEwKYWFxkdht-yr0yNgYT3Oc3SnyglTK7wXwT', // 貼你的
    'username' => 'Monitor',
  ],

  // ===== Thresholds =====
  'threshold' => [
    'warning_sec'  => 6 * 60,   // 6 min
    'critical_sec' => 15 * 60,  // 15 min
  ],

  // ===== Misc =====
  'timezone' => 'Asia/Ho_Chi_Minh', // 你目前在越南可用；台灣可改 Asia/Taipei
  'site_name' => 'ACUMEN VN',
];
