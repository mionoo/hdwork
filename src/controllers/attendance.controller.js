//attendance.controller.js
const attendanceService = require("../services/attendance.service");

async function clockIn(req, res) {
  try {
    const userId = req.user.id;

    const result = await attendanceService.clockIn(userId);

    return res.status(201).json({
      success: true,
      message: "Clock in berhasil",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal clock in",
    });
  }
}

async function startBreak(req, res) {
  try {
    const userId = req.user.id;

    const result = await attendanceService.startBreak(userId);

    return res.status(200).json({
      success: true,
      message: "Break dimulai",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal memulai break",
    });
  }
}

async function onDesk(req, res) {
  try {
    const userId = req.user.id;

    const result = await attendanceService.onDesk(userId);

    return res.status(200).json({
      success: true,
      message: "Kembali On Desk",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal kembali On Desk",
    });
  }
}

async function clockOut(req, res) {
  try {
    const userId = req.user.id;

    const result = await attendanceService.clockOut(userId);

    return res.status(200).json({
      success: true,
      message: "Clock out berhasil",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal clock out",
    });
  }
}

async function getTodayAttendance(req, res) {
  try {
    const userId = req.user.id;

    const result =
      await attendanceService.getTodayAttendance(userId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Gagal mengambil attendance",
    });
  }
}

module.exports = {
  clockIn,
  startBreak,
  onDesk,
  clockOut,
  getTodayAttendance,
};