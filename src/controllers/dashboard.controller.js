const dashboardService = require("../services/dashboard.service");

async function getSummary(req, res) {
  try {
    const userId = req.user.id;
    const cityId = req.query.city_id;

    const result = await dashboardService.getSummary(userId, cityId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal mengambil dashboard",
    });
  }
}

async function getCities(req, res) {
  try {
    const result = await dashboardService.getCities(req.user.id);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal mengambil daftar kota",
    });
  }
}

async function getTeam(req, res) {
  try {
    const result = await dashboardService.getTeam(
      req.user.id,
      req.query.city_id,
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal mengambil data team HD",
    });
  }
}

async function getReports(req, res) {
  try {
    const result = await dashboardService.getReports(
      req.user.id,
      req.query.city_id,
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal mengambil reports",
    });
  }
}

module.exports = {
  getSummary,
  getCities,
  getTeam,
  getReports,
};
