const agentRealtimeService = require("./agent-realtime.service");
const { VPN_HEALTH_HOST } = require("../config/network-tools.config");

async function pingHost(userId, host) {
  return agentRealtimeService.requestPing(userId, host);
}

async function testSshConnection(userId, payload) {
  return agentRealtimeService.requestSshTest(userId, payload);
}

async function getAgentStatus(userId) {
  return { online: agentRealtimeService.isUserAgentConnected(userId), vpn_health_host: VPN_HEALTH_HOST };
}

async function checkVpnPath(userId) {
  return agentRealtimeService.requestPing(userId, VPN_HEALTH_HOST);
}

module.exports = {
  pingHost,
  testSshConnection,
  getAgentStatus,
  checkVpnPath,
};
