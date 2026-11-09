// Cacti is paused by default while order handling is the operational priority.
// Re-enable explicitly through the backend environment and restart the process.
const CACTI_ENABLED = process.env.CACTI_ENABLED === "true";

module.exports = { CACTI_ENABLED };
