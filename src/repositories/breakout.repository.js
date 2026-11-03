const pool = require("../config/database");

async function list(userId) {
  const [[user]] = await pool.query(
    "SELECT role, city_id, is_active FROM users WHERE id = ?", [userId],
  );
  if (!user?.is_active || !["HD", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    throw Object.assign(new Error("Akses Breakout Room tidak tersedia"), { statusCode: 403 });
  }
  if (user.role !== "SUPER_ADMIN" && !user.city_id) return { segments: [], rooms: [] };

  const segmentAccess = user.role === "HD"
    ? "WHERE EXISTS (SELECT 1 FROM user_segments us WHERE us.user_id = ? AND us.segment_id = s.id)"
    : "";
  const segmentParams = user.role === "HD" ? [userId] : [];
  const [segments] = await pool.query(
    `SELECT s.id, s.code FROM segments s ${segmentAccess} ORDER BY s.code`, segmentParams,
  );
  const [rooms] = await pool.query(
    `SELECT tg.id, tg.name, tg.segment_id, tg.workflow, tg.category, c.name AS city_name
     FROM telegram_groups tg
     JOIN cities c ON c.id = tg.city_id
     JOIN segments s ON s.id = tg.segment_id
     ${segmentAccess}
     ${segmentAccess ? "AND" : "WHERE"} tg.is_active = 1
       AND tg.category IN ('PENGAWALAN', 'LOGIC')
       AND tg.workflow IS NOT NULL
       ${user.role === "SUPER_ADMIN" ? "" : "AND tg.city_id = ?"}
     ORDER BY c.name, tg.name, tg.id`,
    [...segmentParams, ...(user.role === "SUPER_ADMIN" ? [] : [user.city_id])],
  );
  return { segments, rooms };
}

module.exports = { list };
