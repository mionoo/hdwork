function displayValue(value) {
  return value || "-";
}

function formatAlarmMessage(customerType, devices) {
  const label = String(customerType || "").toUpperCase();
  const rows = [`⚠️ ALARM CACTI ${label}`, ""];

  devices.forEach((device, index) => {
    rows.push(`${index + 1}. ${displayValue(device.group || device.group_name)}`);
    rows.push(`   ${displayValue(device.name || device.device_name)}`);
    rows.push(`   OLT IP: ${displayValue(device.olt_ip)}`);
    rows.push(`   Slot/Port: ${displayValue(device.slot_port)}`);
    rows.push(`   Status: ${displayValue(device.status || device.alarm_status)}`);
    rows.push(`   Last Cacti: ${displayValue(device.last_cek_cacty || device.last_cacti_check)}`);

    if (index < devices.length - 1) rows.push("");
  });

  return rows.join("\n");
}

function formatCollectorHealthMessage(customerType, health) {
  const label = String(customerType || "").toUpperCase();
  const rows = [`⚠️ HEALTH COLLECTOR CACTI ${label}`, "", `Collector: ${displayValue(health.collector)}`];

  health.problems.forEach((problem) => rows.push(`• ${problem}`));

  rows.push("", "Pemeriksaan berikutnya: maksimal 10 menit lagi.");
  return rows.join("\n");
}

function formatCollectorRecoveredMessage(customerType, collector) {
  return [
    `✅ HEALTH COLLECTOR CACTI ${String(customerType || "").toUpperCase()} PULIH`,
    "",
    `Collector: ${displayValue(collector)}`,
    "Pengiriman data, jalur Cacti, dan scan terakhir kembali normal.",
  ].join("\n");
}

module.exports = {
  formatAlarmMessage,
  formatCollectorHealthMessage,
  formatCollectorRecoveredMessage,
};
