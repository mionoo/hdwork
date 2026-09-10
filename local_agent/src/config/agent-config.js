const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "../../data/agent-config.json");

function loadAgentConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return null; }
}

function saveAgentConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, configPath);
}

module.exports = { loadAgentConfig, saveAgentConfig };
