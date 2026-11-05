const { authenticateToken } = require("../services/auth.service");

async function authMiddleware(req, res, next) {
  const [scheme, token, ...extra] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token || extra.length) {
    return res.status(401).json({ success: false, message: "Token tidak ditemukan atau tidak valid" });
  }
  try {
    const user = await authenticateToken(token);
    if (!user) return res.status(401).json({ success: false, message: "Sesi tidak valid atau akun tidak aktif" });
    req.user = user;
    return next();
  } catch {
    return res.status(503).json({ success: false, message: "Sesi belum dapat diverifikasi. Coba lagi." });
  }
}

module.exports = authMiddleware;
