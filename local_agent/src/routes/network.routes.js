const express = require("express");
const { pingHost } = require("../services/ping.service");

const router = express.Router();

router.post("/ping", async (req, res) => {
  try {
    const { host } = req.body;

    if (!host) {
      return res.status(400).json({
        success: false,
        message: "host is required",
      });
    }

    const result = await pingHost(host);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;