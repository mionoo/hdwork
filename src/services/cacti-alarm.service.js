function displayValue(value) {
  return value || "-";
}

function formatAlarmMessage(customerType, devices) {
  const label = String(customerType || "").toUpperCase();
  const rows = [`⚠️ ALARM CACTI ${label}`, ""];

  devices.forEach((device, index) => {
    rows.push(`${index + 1}. ${displayValue(device.group)}`);
    rows.push(`   ${displayValue(device.name)}`);
    rows.push(`   OLT IP: ${displayValue(device.olt_ip)}`);
    rows.push(`   Slot/Port: ${displayValue(device.slot_port)}`);
    rows.push(`   Status: ${displayValue(device.status)}`);
    rows.push(`   Last Cacti: ${displayValue(device.last_cek_cacty)}`);

    if (index < devices.length - 1) rows.push("");
  });

  
  return rows.join("\n");
}

module.exports = {
  formatAlarmMessage,
};
