const pool = require("../config/database");

async function getCurrentUser(userId) {
  const [rows] = await pool.query(
    `
    SELECT u.id, u.role, u.city_id, u.is_active, c.name AS city_name
    FROM users u
    LEFT JOIN cities c ON c.id = u.city_id
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    const error = new Error("User tidak ditemukan");
    error.statusCode = 404;
    throw error;
  }

  if (!rows[0].is_active) {
    const error = new Error("User tidak aktif");
    error.statusCode = 403;
    throw error;
  }

  return rows[0];
}

function resolveCityScope(user, requestedCityId, allowHd = true) {
  if (user.role === "SUPER_ADMIN") {
    return requestedCityId ? Number(requestedCityId) : null;
  }

  if ((user.role === "ADMIN" || (allowHd && user.role === "HD")) && user.city_id) {
    if (requestedCityId && Number(requestedCityId) !== Number(user.city_id)) {
      const error = new Error("Anda hanya dapat mengakses data kota sendiri");
      error.statusCode = 403;
      throw error;
    }

    return Number(user.city_id);
  }

  const error = new Error("Anda tidak memiliki akses ke data ini");
  error.statusCode = 403;
  throw error;
}

function cityCondition(cityId, alias = "tg") {
  return cityId
    ? { clause: `WHERE ${alias}.city_id = ?`, params: [cityId] }
    : { clause: "", params: [] };
}

async function getSummary(userId, requestedCityId) {
  const user = await getCurrentUser(userId);

  if (user.role === "HD") {
    return getHdSummary(user);
  }

  const cityId = resolveCityScope(user, requestedCityId, false);
  const scope = cityCondition(cityId);

  const [statusRows] = await pool.query(
    `
    SELECT o.status, COUNT(*) AS total
    FROM orders o
    JOIN telegram_groups tg ON tg.id = o.telegram_group_id
    ${scope.clause}
    GROUP BY o.status
    `,
    scope.params,
  );

  const totals = { WAITING: 0, IN_PROGRESS: 0, ESCALATED: 0, DONE: 0 };
  statusRows.forEach((row) => {
    totals[row.status] = Number(row.total);
  });

  const [doneRows] = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM orders o
    JOIN telegram_groups tg ON tg.id = o.telegram_group_id
    ${scope.clause ? `${scope.clause} AND` : "WHERE"} o.status = 'DONE'
      AND DATE(o.completed_at) = CURDATE()
    `,
    scope.params,
  );

  const teamScope = cityId ? "WHERE u.city_id = ?" : "";
  const teamParams = cityId ? [cityId] : [];
  const [teamRows] = await pool.query(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(a.clock_out_at IS NULL AND a.id IS NOT NULL), 0) AS active_today,
      COALESCE(SUM(a.id IS NULL), 0) AS not_clocked_in
    FROM users u
    LEFT JOIN attendance a
      ON a.user_id = u.id
      AND a.work_date = CURDATE()
    ${teamScope}
      ${teamScope ? "AND" : "WHERE"} u.role = 'HD'
      AND u.is_active = 1
    `,
    teamParams,
  );

  return {
    waiting: totals.WAITING,
    in_progress: totals.IN_PROGRESS,
    escalated: totals.ESCALATED,
    done_today: Number(doneRows[0].total),
    active_hds: Number(teamRows[0].active_today),
    total_hds: Number(teamRows[0].total),
    not_clocked_in: Number(teamRows[0].not_clocked_in),
    city_id: cityId,
    city_name: cityId ? (await getCityName(cityId)) : "Semua kota",
  };
}

async function getHdSummary(user) {
  const [segmentRows] = await pool.query(
    "SELECT segment_id FROM user_segments WHERE user_id = ?",
    [user.id],
  );
  const segmentIds = segmentRows.map((row) => row.segment_id);
  let waiting = 0;
  let inProgress = 0;
  let escalated = 0;

  if (segmentIds.length > 0) {
    const placeholders = segmentIds.map(() => "?").join(",");
    const [statusRows] = await pool.query(
      `
      SELECT o.status, COUNT(*) AS total
      FROM orders o
      JOIN telegram_groups tg ON tg.id = o.telegram_group_id
      WHERE tg.city_id = ?
        AND tg.segment_id IN (${placeholders})
        AND o.status IN ('WAITING', 'IN_PROGRESS', 'ESCALATED')
      GROUP BY o.status
      `,
      [user.city_id, ...segmentIds],
    );
    statusRows.forEach((row) => {
      if (row.status === "WAITING") waiting = Number(row.total);
      if (row.status === "IN_PROGRESS") inProgress = Number(row.total);
      if (row.status === "ESCALATED") escalated = Number(row.total);
    });
  }

  const [activeRows] = await pool.query(
    "SELECT COUNT(*) AS total FROM order_assignments WHERE user_id = ? AND released_at IS NULL",
    [user.id],
  );
  const [doneRows] = await pool.query(
    `
    SELECT COUNT(*) AS total, COALESCE(SUM(point_value), 0) AS total_point
    FROM orders
    WHERE performance_owner_id = ? AND status = 'DONE' AND DATE(completed_at) = CURDATE()
    `,
    [user.id],
  );

  return {
    waiting,
    in_progress: inProgress,
    escalated,
    done_today: Number(doneRows[0].total),
    active_orders: Number(activeRows[0].total),
    active_order_limit: 10,
    point_today: Number(doneRows[0].total_point),
  };
}

async function getCityName(cityId) {
  const [rows] = await pool.query("SELECT name FROM cities WHERE id = ?", [cityId]);
  return rows[0]?.name || "Kota";
}

async function getCities(userId) {
  const user = await getCurrentUser(userId);

  if (user.role === "SUPER_ADMIN") {
    const [cities] = await pool.query("SELECT id, name FROM cities ORDER BY name ASC");
    return cities;
  }

  if (user.role === "ADMIN" && user.city_id) {
    return [{ id: Number(user.city_id), name: user.city_name }];
  }

  const error = new Error("Daftar kota hanya tersedia untuk admin");
  error.statusCode = 403;
  throw error;
}

async function getTeam(userId, requestedCityId) {
  const user = await getCurrentUser(userId);
  const cityId = resolveCityScope(user, requestedCityId, false);
  const scope = cityId ? "WHERE u.city_id = ?" : "";
  const params = cityId ? [cityId] : [];

  const [rows] = await pool.query(
    `
    SELECT
      u.id,
      u.name,
      u.username,
      c.name AS city_name,
      GROUP_CONCAT(DISTINCT s.code ORDER BY s.code SEPARATOR ', ') AS segments,
      CASE
        WHEN a.id IS NULL THEN 'NOT_CLOCKED_IN'
        WHEN a.clock_out_at IS NOT NULL THEN 'CLOCKED_OUT'
        WHEN active_break.id IS NOT NULL THEN 'BREAK'
        ELSE 'ON_DESK'
      END AS attendance_status,
      COUNT(DISTINCT oa.id) AS active_orders
    FROM users u
    JOIN cities c ON c.id = u.city_id
    LEFT JOIN user_segments us ON us.user_id = u.id
    LEFT JOIN segments s ON s.id = us.segment_id
    LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = CURDATE()
    LEFT JOIN attendance_breaks active_break
      ON active_break.attendance_id = a.id
      AND active_break.break_end_at IS NULL
    LEFT JOIN order_assignments oa
      ON oa.user_id = u.id
      AND oa.released_at IS NULL
    ${scope}
      ${scope ? "AND" : "WHERE"} u.role = 'HD'
      AND u.is_active = 1
    GROUP BY u.id, u.name, u.username, c.name, a.id, a.clock_out_at, active_break.id
    ORDER BY active_orders DESC, u.name ASC
    `,
    params,
  );

  return rows.map((row) => ({
    ...row,
    active_orders: Number(row.active_orders),
    segments: row.segments || "Belum diatur",
  }));
}

async function getReports(userId, requestedCityId) {
  const user = await getCurrentUser(userId);
  const cityId = resolveCityScope(user, requestedCityId, false);
  const scope = cityCondition(cityId);

  const [summaryRows] = await pool.query(
    `
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(o.status = 'DONE'), 0) AS done_orders,
      COALESCE(SUM(o.status = 'ESCALATED'), 0) AS escalated_orders,
      COALESCE(AVG(CASE WHEN o.status = 'DONE' THEN TIMESTAMPDIFF(MINUTE, o.created_at, o.completed_at) END), 0) AS average_resolution_minutes
    FROM orders o
    JOIN telegram_groups tg ON tg.id = o.telegram_group_id
    ${scope.clause ? `${scope.clause} AND` : "WHERE"} o.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
    `,
    scope.params,
  );

  const [dailyRows] = await pool.query(
    `
    SELECT
      DATE(o.created_at) AS work_date,
      COUNT(*) AS total,
      COALESCE(SUM(o.status = 'DONE'), 0) AS done,
      COALESCE(SUM(o.status = 'ESCALATED'), 0) AS escalated
    FROM orders o
    JOIN telegram_groups tg ON tg.id = o.telegram_group_id
    ${scope.clause ? `${scope.clause} AND` : "WHERE"} o.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
    GROUP BY DATE(o.created_at)
    ORDER BY work_date ASC
    `,
    scope.params,
  );

  const [performerRows] = await pool.query(
    `
    SELECT u.name, COUNT(*) AS completed_orders
    FROM orders o
    JOIN users u ON u.id = o.performance_owner_id
    JOIN telegram_groups tg ON tg.id = o.telegram_group_id
    ${scope.clause ? `${scope.clause} AND` : "WHERE"} o.status = 'DONE'
      AND o.completed_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
    GROUP BY u.id, u.name
    ORDER BY completed_orders DESC, u.name ASC
    LIMIT 5
    `,
    scope.params,
  );

  const summary = summaryRows[0];
  return {
    total_orders: Number(summary.total_orders),
    done_orders: Number(summary.done_orders),
    escalated_orders: Number(summary.escalated_orders),
    average_resolution_minutes: Number(summary.average_resolution_minutes),
    daily: dailyRows.map((row) => ({
      ...row,
      total: Number(row.total),
      done: Number(row.done),
      escalated: Number(row.escalated),
    })),
    performers: performerRows.map((row) => ({
      ...row,
      completed_orders: Number(row.completed_orders),
    })),
  };
}

module.exports = {
  getSummary,
  getCities,
  getTeam,
  getReports,
};
