const express = require("express");

const networkController = require(
  "../controllers/network.controller",
);

const authMiddleware = require(
  "../middlewares/auth.middleware",
);

const router = express.Router();

router.use(authMiddleware);

router.post("/terminal/logout", (req, res) => {
  require("../services/terminal-realtime.service").closeLoginSessions(req.headers.authorization.split(" ")[1]);
  res.json({ success: true });
});

router.post("/ping", networkController.ping);
router.post("/ssh-test", networkController.sshTest);
router.get("/status", networkController.status);
router.get("/vpn-health", networkController.vpnHealth);

module.exports = router;
