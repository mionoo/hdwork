const crypto = require("crypto");

function verifyCactiCollector(req, res, next) {
  const collectorKey = req.headers["x-collector-key"];

  if (!collectorKey) {
    return res.status(401).json({
      success: false,
      message: "API key collector tidak ditemukan",
    });
  }

  const expectedKey = process.env.CACTI_COLLECTOR_API_KEY;
  if (!expectedKey) {
    return res.status(500).json({
      success: false,
      message: "Konfigurasi API key collector belum tersedia",
    });
  }

  if (
    typeof collectorKey !== "string"
    || collectorKey.length !== expectedKey.length
    || !crypto.timingSafeEqual(
      Buffer.from(collectorKey),
      Buffer.from(expectedKey),
    )
  ) {
    return res.status(403).json({
      success: false,
      message: "API key collector tidak valid",
    });
  }

  return next();
}

module.exports = verifyCactiCollector;
