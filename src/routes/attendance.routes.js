//attedance.routes.js

const express = require("express");
const attendanceController = require("../controllers/attendance.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(authMiddleware);

router.post("/clock-in", attendanceController.clockIn);
router.post("/break", attendanceController.startBreak);
router.post("/on-desk", attendanceController.onDesk);
router.post("/clock-out", attendanceController.clockOut);
router.get("/today", attendanceController.getTodayAttendance);

module.exports = router;
