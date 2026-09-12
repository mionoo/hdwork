const pool = require("../config/database");
const telegramRepository = require("../repositories/telegram.repository");
const telegramService = require("./telegram.service");
const {
  formatAlarmMessage,
  formatCollectorHealthMessage,
  formatCollectorRecoveredMessage,
} = require("./cacti-alarm.service");

const HEALTH_STALE_AFTER_SECONDS = Number(process.env.CACTI_COLLECTOR_STALE_AFTER_SECONDS || 15 * 60);
const TELEGRAM_MESSAGE_LIMIT = 3900;
let schedulerStarted = false;
let schedulerRunning = false;

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function splitAlarmDevices(customerType, devices) {
  const batches = [];
  let batch = [];

  for (const device of devices) {
    const candidate = [...batch, device];
    if (batch.length > 0 && formatAlarmMessage(customerType, candidate).length > TELEGRAM_MESSAGE_LIMIT) {
      batches.push(batch);
      batch = [device];
    } else {
      batch = candidate;
    }
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function recordCollectorHealth({ collector, customerType, health = {}, scans = [] }) {
  const ping = health.cacti_ping || {};
  const failedScans = scans.filter((scan) => scan.status !== "success");
  const scanSummary = scans.map((scan) => ({
    server: scan.server,
    status: scan.status,
    error: scan.error || null,
  }));

  await pool.query(
    `
    INSERT INTO cacti_collector_health (
      collector, customer_type, last_received_at,
      last_ping_host, last_ping_reachable, last_ping_latency_ms, last_ping_error,
      last_scan_failed_count, last_scan_summary
    ) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      last_received_at = NOW(),
      last_ping_host = VALUES(last_ping_host),
      last_ping_reachable = VALUES(last_ping_reachable),
      last_ping_latency_ms = VALUES(last_ping_latency_ms),
      last_ping_error = VALUES(last_ping_error),
      last_scan_failed_count = VALUES(last_scan_failed_count),
      last_scan_summary = VALUES(last_scan_summary)
    `,
    [
      collector || "UNKNOWN_COLLECTOR",
      customerType,
      ping.host || null,
      typeof ping.reachable === "boolean" ? ping.reachable : null,
      Number.isFinite(ping.latency_ms) ? ping.latency_ms : null,
      ping.error || null,
      failedScans.length,
      JSON.stringify(scanSummary),
    ],
  );
}

async function sendActiveAlarms() {
  const [rows] = await pool.query(
    `SELECT * FROM cacti_alarms WHERE alarm_state = 'ACTIVE' ORDER BY customer_type, server, group_name, device_name`,
  );
  const devicesByCustomerType = new Map();
  for (const device of rows) {
    const key = String(device.customer_type || "").toLowerCase();
    if (!devicesByCustomerType.has(key)) devicesByCustomerType.set(key, []);
    devicesByCustomerType.get(key).push(device);
  }

  for (const [customerType, devices] of devicesByCustomerType) {
    const destination = await telegramRepository.getAlarmDestination(customerType);
    const subscribers = await telegramRepository.getAlarmSubscribers(customerType);
    const batches = splitAlarmDevices(customerType, devices);

    if (!destination && !subscribers.length) {
      console.warn(`Tujuan alarm Telegram Cacti belum terdaftar: ${customerType}`);
      continue;
    }

    for (const batch of batches) {
      const message = formatAlarmMessage(customerType, batch);
      if (destination) {
        const delivery = await telegramService.sendMessage(
          destination.telegram_chat_id,
          message,
          destination.telegram_thread_id,
        );
        if (!delivery.delivered) console.error(`Alarm Cacti ${customerType} gagal dikirim: ${delivery.error}`);
      }

      for (const subscriber of subscribers) {
        const delivery = await telegramService.sendPersonalAlarmMessage(subscriber.telegram_chat_id, message);
        if (delivery.delivered) continue;

        console.error(`Alarm personal Cacti ${customerType} ke ${subscriber.telegram_user_id} gagal dikirim: ${delivery.error}`);
        if (delivery.error_code === 403) {
          await telegramRepository.deactivateAlarmSubscriber(customerType, subscriber.telegram_user_id);
        }
      }
    }
  }
}

function healthProblems(row) {
  const problems = [];
  if (Number(row.seconds_since_received) > HEALTH_STALE_AFTER_SECONDS) {
    problems.push(`Tidak ada kiriman ke backend selama ${Math.floor(Number(row.seconds_since_received) / 60)} menit.`);
    return problems;
  }
  if (Number(row.last_ping_reachable) === 0) {
    problems.push(`Jalur ke Cacti ${row.last_ping_host || "-"} tidak dapat dijangkau${row.last_ping_error ? ` (${row.last_ping_error})` : "."}`);
  }
  if (Number(row.last_scan_failed_count) > 0) {
    const failed = safeJson(row.last_scan_summary, []).filter((scan) => scan.status !== "success");
    const detail = failed.map((scan) => `${scan.server}: ${scan.error || "scan gagal"}`).join("; ");
    problems.push(`Scan Cacti gagal pada ${detail || `${row.last_scan_failed_count} server`}.`);
  }
  return problems;
}

async function sendCollectorHealth() {
  const [rows] = await pool.query(
    `
    SELECT *, TIMESTAMPDIFF(SECOND, last_received_at, NOW()) AS seconds_since_received
    FROM cacti_collector_health
    `,
  );

  for (const row of rows) {
    const problems = healthProblems(row);
    const unhealthy = problems.length > 0;
    const destination = await telegramRepository.getAlarmDestination(row.customer_type);

    if (destination && unhealthy) {
      const delivery = await telegramService.sendMessage(
        destination.telegram_chat_id,
        formatCollectorHealthMessage(row.customer_type, { collector: row.collector, problems }),
        destination.telegram_thread_id,
      );
      if (!delivery.delivered) console.error(`Health collector ${row.customer_type} gagal dikirim: ${delivery.error}`);
    }
    if (destination && !unhealthy && row.last_alert_state === "UNHEALTHY") {
      const delivery = await telegramService.sendMessage(
        destination.telegram_chat_id,
        formatCollectorRecoveredMessage(row.customer_type, row.collector),
        destination.telegram_thread_id,
      );
      if (!delivery.delivered) console.error(`Pemulihan collector ${row.customer_type} gagal dikirim: ${delivery.error}`);
    }

    await pool.query(
      "UPDATE cacti_collector_health SET last_alert_state = ?, last_health_checked_at = NOW() WHERE id = ?",
      [unhealthy ? "UNHEALTHY" : "HEALTHY", row.id],
    );
  }
}

async function runScheduledNotifications() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    await sendActiveAlarms();
    await sendCollectorHealth();
  } catch (error) {
    console.error("Penjadwalan alarm Cacti gagal:", error.message);
  } finally {
    schedulerRunning = false;
  }
}

function millisecondsUntilNextTenMinuteMark(now = new Date()) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  const minutesUntilNextMark = 10 - (next.getMinutes() % 10);
  next.setMinutes(next.getMinutes() + minutesUntilNextMark);
  return next.getTime() - now.getTime();
}

function scheduleNextRun() {
  const delay = millisecondsUntilNextTenMinuteMark();
  setTimeout(async () => {
    await runScheduledNotifications();
    scheduleNextRun();
  }, delay);
}

function startCactiScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  scheduleNextRun();
  console.log("⏱️ Alarm Cacti dijadwalkan pada menit 00, 10, 20, 30, 40, dan 50");
}

module.exports = {
  recordCollectorHealth,
  runScheduledNotifications,
  startCactiScheduler,
  splitAlarmDevices,
  millisecondsUntilNextTenMinuteMark,
};
