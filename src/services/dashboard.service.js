const dashboardRepository = require("../repositories/dashboard.repository");

async function getSummary(userId, cityId) {
  return await dashboardRepository.getSummary(userId, cityId);
}

async function getCities(userId) {
  return await dashboardRepository.getCities(userId);
}

async function getTeam(userId, cityId) {
  return await dashboardRepository.getTeam(userId, cityId);
}

async function getReports(userId, cityId) {
  return await dashboardRepository.getReports(userId, cityId);
}

module.exports = {
  getSummary,
  getCities,
  getTeam,
  getReports,
};
