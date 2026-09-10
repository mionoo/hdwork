const express = require("express");


const dashboardController = require("../controllers/dashboard.controller");

const authMiddleware = require("../middlewares/auth.middleware");


const router = express.Router();

router.use(authMiddleware);

router.get("/summary", dashboardController.getSummary);
router.get("/cities", dashboardController.getCities);
router.get("/team", dashboardController.getTeam);
router.get("/reports", dashboardController.getReports);

module.exports = router;
