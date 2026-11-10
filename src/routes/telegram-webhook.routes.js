const express = require("express");
const { timingSafeEqual } = require("node:crypto");
const { readTelegramConfig } = require("../config/telegram");
const inbox = require("../repositories/telegram-webhook.repository");
const router = express.Router();

router.post("/webhook", (req, res, next) => {
  let config;
  try { config = readTelegramConfig(); }
  catch { return res.status(503).json({ success: false, message: "Konfigurasi webhook belum siap." }); }
  if (config.mode !== "webhook") return res.status(503).json({ success: false, message: "Mode webhook tidak aktif." });
  const supplied = Buffer.from(req.get("X-Telegram-Bot-Api-Secret-Token") || "");
  const expected = Buffer.from(config.secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(403).json({ success: false, message: "Secret webhook tidak valid." });
  }
  req.telegramBotId = config.botId;
  next();
}, express.json({ limit: "1mb" }), async (req, res) => {
  const update = req.body;
  if (!update || Array.isArray(update) || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
    return res.status(400).json({ success: false, message: "Update Telegram tidak valid." });
  }
  try {
    await inbox.enqueue(req.telegramBotId, update);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Penyimpanan inbox webhook gagal", { code: error.code || "DATABASE_ERROR" });
    return res.status(503).json({ success: false, message: "Inbox belum dapat menyimpan pesan. Telegram perlu mencoba ulang." });
  }
});
router.use((error, req, res, next) => {
  if (["entity.too.large", "entity.parse.failed"].includes(error.type)) {
    return res.status(error.type === "entity.too.large" ? 413 : 400).json({ success: false, message: "Payload webhook tidak valid atau terlalu besar." });
  }
  next(error);
});
module.exports = router;
