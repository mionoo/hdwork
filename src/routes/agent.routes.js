const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const agentController = require("../controllers/agent.controller");

const router = express.Router();
router.use(authMiddleware);
router.post("/pair", agentController.pair);
router.post("/", agentController.create);
module.exports = router;
