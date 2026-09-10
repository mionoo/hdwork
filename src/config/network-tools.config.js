const VPN_HEALTH_HOST = process.env.VPN_HEALTH_HOST || "10.60.190.16";
const ZTE_DEFAULT_FRAME = Number(process.env.ZTE_DEFAULT_FRAME || 1);

// Browser refresh/network reconnect grace period, in seconds.
const configuredGrace = Number(process.env.SSH_RESUME_GRACE_SECONDS || 60);
const SSH_RESUME_GRACE_MS = (Number.isFinite(configuredGrace) && configuredGrace > 0 ? configuredGrace : 60) * 1000;
const SSH_OUTPUT_BUFFER_BYTES = 256 * 1024;
// Keep in sync with MAX_MANUAL_TERMINALS in the frontend workspace.
const SSH_MAX_MANUAL_SESSIONS = 5;

module.exports = { VPN_HEALTH_HOST, ZTE_DEFAULT_FRAME, SSH_RESUME_GRACE_MS, SSH_OUTPUT_BUFFER_BYTES, SSH_MAX_MANUAL_SESSIONS };
