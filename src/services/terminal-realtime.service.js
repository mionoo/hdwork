const agent = require("./agent-realtime.service");
const zteTools = require("./zte-tools.service");
const { createTerminalSessionManager } = require("./terminal-session-manager");
const { SSH_RESUME_GRACE_MS, SSH_OUTPUT_BUFFER_BYTES, SSH_MAX_MANUAL_SESSIONS } = require("../config/network-tools.config");

module.exports = createTerminalSessionManager({
  agent,
  executeTool: zteTools.execute,
  graceMs: SSH_RESUME_GRACE_MS,
  outputBytes: SSH_OUTPUT_BUFFER_BYTES,
  maxManualSessions: SSH_MAX_MANUAL_SESSIONS,
});
