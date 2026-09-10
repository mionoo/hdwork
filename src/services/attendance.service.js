const attendanceRepository = require("../repositories/attendance.repository");

async function clockIn(userId) {
  return await attendanceRepository.clockIn(userId);
}

async function startBreak(userId) {
  return await attendanceRepository.startBreak(userId);
}

async function onDesk(userId) {
  return await attendanceRepository.onDesk(userId);
}

async function clockOut(userId) {
  return await attendanceRepository.clockOut(userId);
}


async function getTodayAttendance(userId) {
  return await attendanceRepository.getTodayAttendance(userId);
}

module.exports = {
  clockIn,
  startBreak,
  onDesk,
  clockOut,
  getTodayAttendance
};