const { ZTE_DEFAULT_FRAME } = require("../config/network-tools.config");

const TOOL = {
  STATUS: "CHECK_ONT_STATUS",
  OPTICAL: "CHECK_ONT_OPTICAL",
  ONTS_IN_PORT: "CHECK_ONTS_IN_PORT",
  PORT_OPTICAL: "CHECK_PORT_OPTICAL",
  PORT_INTERFACE: "CHECK_OLT_PORT",
  SEARCH: "SEARCH_ONT",
  UNCONFIGURED: "GET_UNCONFIGURED_ONTS",
};

function integer(value, label) {
  if (!/^\d+$/.test(String(value ?? "")) || Number(value) < 0) {
    const error = new Error(`${label} harus berupa angka bulat positif`);
    error.statusCode = 400;
    throw error;
  }
  return Number(value);
}

function ontLocation(input) {
  return { slot: integer(input.slot, "Slot"), port: integer(input.port, "Port"), onuId: integer(input.onu_id, "ONU ID") };
}

function portLocation(input) {
  return { slot: integer(input.slot, "Slot"), port: integer(input.port, "Port") };
}

function serialNumber(value) {
  const sn = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(sn)) {
    const error = new Error("Serial Number hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung");
    error.statusCode = 400;
    throw error;
  }
  return sn;
}

function errorInfo(rawOutput) {
  const match = String(rawOutput).match(/%(?:Error|Code)\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function stateFromOutput(rawOutput, emptyCodes = []) {
  const code = errorInfo(rawOutput);
  if (code === 20200 || code === 20202) return { status: "NOT_FOUND", errorCode: code };
  if (emptyCodes.includes(code)) return { status: "EMPTY", errorCode: code };
  return null;
}

function lineValue(rawOutput, name) {
  return String(rawOutput).match(new RegExp(`^${name}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() || null;
}

function numeric(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parsePowerLine(line, direction) {
  const tokens = {};
  for (const [, key, value] of String(line).matchAll(/(Rx|Tx)\s*:\s*([^\s]+(?:\([^)]*\))?)/gi)) tokens[key.toLowerCase()] = value;
  const attenuation = String(line).match(/\s(-?\d+(?:\.\d+)?)\s*\(dB\)/i)?.[1];
  return direction === "upstream"
    ? { oltRx: numeric(tokens.rx), onuTx: numeric(tokens.tx), attenuation: attenuation == null ? null : Number(attenuation), oltRxStatus: /no signal/i.test(tokens.rx || "") ? "NO_SIGNAL" : null }
    : { oltTx: numeric(tokens.tx), onuRx: numeric(tokens.rx), attenuation: attenuation == null ? null : Number(attenuation), onuRxStatus: /no signal/i.test(tokens.rx || "") ? "NO_SIGNAL" : null };
}

function parseStatus(rawOutput) {
  const phaseState = lineValue(rawOutput, "Phase state");
  const known = { working: "ONLINE", dyinggasp: "OFFLINE" };
  return {
    status: phaseState ? (known[phaseState.toLowerCase()] || "UNKNOWN") : "UNKNOWN",
    phaseState,
    interface: lineValue(rawOutput, "ONU interface"),
    name: lineValue(rawOutput, "Name"),
    ontType: lineValue(rawOutput, "Type"),
    serialNumber: lineValue(rawOutput, "Serial number"),
    distance: lineValue(rawOutput, "ONU Distance"),
    onlineDuration: lineValue(rawOutput, "Online Duration"),
  };
}

function parseOntsInPort(rawOutput) {
  const onts = [];
  for (const line of String(rawOutput).split(/\r?\n/)) {
    const row = line.match(/^\s*(?:gpon-onu_)?1\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/i);
    if (row) onts.push({ interface: `gpon-onu_${ZTE_DEFAULT_FRAME}/${row[1]}/${row[2]}:${row[3]}`, slot: Number(row[1]), port: Number(row[2]), onuId: Number(row[3]), adminState: row[4], omccState: row[5], phaseState: row[6], channel: row[7] });
  }
  const count = String(rawOutput).match(/ONU Number\s*:\s*(\d+)\/(\d+)/i);
  return { onts, online: count ? Number(count[1]) : onts.filter((ont) => ont.phaseState.toLowerCase() === "working").length, registered: count ? Number(count[2]) : onts.length, offline: count ? Number(count[2]) - Number(count[1]) : null };
}

function parsePowerRows(rawOutput) {
  const rows = new Map();
  for (const line of String(rawOutput).split(/\r?\n/)) {
    const match = line.match(/gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)\s+(N\/A|-?\d+(?:\.\d+)?)\s*(?:\(dbm\))?/i);
    if (match) rows.set(match[0].split(/\s+/)[0], { interface: `gpon-onu_${match[1]}/${match[2]}/${match[3]}:${match[4]}`, slot: Number(match[2]), port: Number(match[3]), onuId: Number(match[4]), value: /^N\/A$/i.test(match[5]) ? null : Number(match[5]) });
  }
  return rows;
}

function parseOltPort(rawOutput) {
  const state = String(rawOutput).match(/is\s+(\w+),\s*line protocol is\s+(\w+)/i);
  const capacity = String(rawOutput).match(/has\s+(\d+)\s+onus,\s+the number of registered onus is\s+(\d+)/i);
  return { interfaceState: state?.[1] || null, lineProtocol: state?.[2] || null, maxOnu: capacity ? Number(capacity[1]) : null, registeredOnu: capacity ? Number(capacity[2]) : null, inputRateBps: numeric(String(rawOutput).match(/Input rate\s*:\s*([^\r\n]+)/i)?.[1]), outputRateBps: numeric(String(rawOutput).match(/Output rate\s*:\s*([^\r\n]+)/i)?.[1]) };
}

function parseUnconfigured(rawOutput) {
  const onts = [];
  for (const line of String(rawOutput).split(/\r?\n/)) {
    const match = line.match(/gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)\s+([A-Za-z0-9_-]+)\s+(\S+)/i);
    if (match) onts.push({ interface: `gpon-onu_${match[1]}/${match[2]}/${match[3]}:${match[4]}`, slot: Number(match[2]), port: Number(match[3]), onuId: Number(match[4]), serialNumber: match[5], state: match[6] });
  }
  return onts;
}

async function execute(tool, input, runCommand) {
  const run = async (command) => {
    const result = await runCommand(command);
    if (!result?.success) { const error = new Error(result?.message || "Command OLT gagal dijalankan"); error.rawOutput = result?.raw_output; throw error; }
    return result.raw_output || "";
  };

  if (tool === TOOL.STATUS) {
    const { slot, port, onuId } = ontLocation(input);
    const rawOutput = await run(`show gpon onu detail-info gpon-onu_${ZTE_DEFAULT_FRAME}/${slot}/${port}:${onuId}`);
    const state = stateFromOutput(rawOutput);
    return { success: true, tool, summary: state || parseStatus(rawOutput), parsed: state || parseStatus(rawOutput), rawOutput };
  }
  if (tool === TOOL.OPTICAL) {
    const { slot, port, onuId } = ontLocation(input);
    const rawOutput = await run(`show pon power attenuation gpon-onu_${ZTE_DEFAULT_FRAME}/${slot}/${port}:${onuId}`);
    const state = stateFromOutput(rawOutput);
    const parsed = state || { upstream: parsePowerLine(String(rawOutput).match(/^\s*up\s+(.+)$/im)?.[1], "upstream"), downstream: parsePowerLine(String(rawOutput).match(/^\s*down\s+(.+)$/im)?.[1], "downstream") };
    return { success: true, tool, summary: state || { status: "AVAILABLE" }, parsed, rawOutput };
  }
  if (tool === TOOL.ONTS_IN_PORT) {
    const { slot, port } = portLocation(input);
    const rawOutput = await run(`show gpon onu state gpon-olt_${ZTE_DEFAULT_FRAME}/${slot}/${port}`);
    const state = stateFromOutput(rawOutput, [62310]);
    const parsed = state || parseOntsInPort(rawOutput);
    return { success: true, tool, summary: state || { status: parsed.registered ? "AVAILABLE" : "EMPTY", online: parsed.online, registered: parsed.registered, offline: parsed.offline }, parsed, rawOutput };
  }
  if (tool === TOOL.PORT_OPTICAL) {
    const { slot, port } = portLocation(input);
    const onuRaw = await run(`show pon power onu-rx gpon-olt_${ZTE_DEFAULT_FRAME}/${slot}/${port}`);
    const oltRaw = await run(`show pon power olt-rx gpon-olt_${ZTE_DEFAULT_FRAME}/${slot}/${port}`);
    const state = stateFromOutput(onuRaw, [70285]) || stateFromOutput(oltRaw, [70285]);
    const onuRows = parsePowerRows(onuRaw); const oltRows = parsePowerRows(oltRaw);
    const parsed = state || { onts: [...new Set([...onuRows.keys(), ...oltRows.keys()])].map((key) => ({ ...(onuRows.get(key) || oltRows.get(key)), onuRx: onuRows.get(key)?.value ?? null, oltRx: oltRows.get(key)?.value ?? null })) };
    return { success: true, tool, summary: state || { status: parsed.onts.length ? "AVAILABLE" : "EMPTY", total: parsed.onts.length }, parsed, rawOutput: `[ONU RX]\n${onuRaw}\n\n[OLT RX]\n${oltRaw}` };
  }
  if (tool === TOOL.PORT_INTERFACE) {
    const { slot, port } = portLocation(input);
    const rawOutput = await run(`show interface gpon-olt_${ZTE_DEFAULT_FRAME}/${slot}/${port}`);
    const state = stateFromOutput(rawOutput);
    const parsed = state || parseOltPort(rawOutput);
    return { success: true, tool, summary: state || { status: parsed.registeredOnu === 0 ? "EMPTY" : "AVAILABLE", interfaceState: parsed.interfaceState, lineProtocol: parsed.lineProtocol, registeredOnu: parsed.registeredOnu }, parsed, rawOutput };
  }
  if (tool === TOOL.UNCONFIGURED) {
    const rawOutput = await run("show gpon onu uncfg");
    const onts = parseUnconfigured(rawOutput);
    return { success: true, tool, summary: { status: "AVAILABLE", total: onts.length }, parsed: { onts }, rawOutput };
  }
  if (tool === TOOL.SEARCH) {
    const sn = serialNumber(input.serial_number);
    const registeredRaw = await run(`show gpon onu by sn ${sn}`);
    if (errorInfo(registeredRaw) === 20202) return { success: true, tool, summary: { status: "INVALID_PARAMETER", serialNumber: sn }, parsed: { status: "INVALID_PARAMETER", errorCode: 20202 }, rawOutput: registeredRaw };
    const registered = registeredRaw.match(/gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)/i);
    if (registered) {
      const parsed = { status: "REGISTERED", serialNumber: sn, interface: registered[0], slot: Number(registered[2]), port: Number(registered[3]), onuId: Number(registered[4]) };
      return { success: true, tool, summary: parsed, parsed, rawOutput: registeredRaw };
    }
    const unconfiguredRaw = await run("show gpon onu uncfg");
    const match = parseUnconfigured(unconfiguredRaw).find((ont) => ont.serialNumber.toUpperCase() === sn.toUpperCase());
    const parsed = match ? { status: "UNREGISTERED", ...match } : { status: "NOT_FOUND", serialNumber: sn };
    return { success: true, tool, summary: parsed, parsed, rawOutput: `[REGISTERED SEARCH]\n${registeredRaw}\n\n[UNCONFIGURED SEARCH]\n${unconfiguredRaw}` };
  }
  const error = new Error("Jenis Quick Action tidak didukung"); error.statusCode = 400; throw error;
}

module.exports = { TOOL, execute };
