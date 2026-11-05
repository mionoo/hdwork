const bcrypt = require("bcrypt");
const pool = require("../config/database");

async function getActor(actorId) {
  const [rows] = await pool.query(
    "SELECT id, role, city_id, is_active FROM users WHERE id = ? LIMIT 1",
    [actorId],
  );
  const actor = rows[0];
  if (!actor || !actor.is_active) {
    const error = new Error("Akun tidak aktif atau tidak ditemukan");
    error.statusCode = 403;
    throw error;
  }
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    const error = new Error("Hanya admin yang dapat mengelola user");
    error.statusCode = 403;
    throw error;
  }
  return actor;
}

function validateScope(actor, payload, target) {
  if (actor.role === "SUPER_ADMIN") return;
  if (payload.role && payload.role !== "HD") {
    const error = new Error("ADMIN hanya dapat mengelola role HD");
    error.statusCode = 403;
    throw error;
  }
  const targetCityId = payload.city_id || target?.city_id;
  if (Number(targetCityId) !== Number(actor.city_id)) {
    const error = new Error("ADMIN hanya dapat mengelola user di kota sendiri");
    error.statusCode = 403;
    throw error;
  }
  if (target && target.role !== "HD") {
    const error = new Error("ADMIN hanya dapat mengelola role HD");
    error.statusCode = 403;
    throw error;
  }
}

async function listUsers(actorId, { cityId, search }) {
  const actor = await getActor(actorId);
  if (actor.role === "ADMIN" && cityId && Number(cityId) !== Number(actor.city_id)) validateScope(actor, { city_id: cityId });
  const effectiveCityId = actor.role === "ADMIN" ? actor.city_id : cityId || null;
  const conditions = [];
  const params = [];
  if (effectiveCityId) { conditions.push("u.city_id = ?"); params.push(effectiveCityId); }
  if (actor.role === "ADMIN") conditions.push("u.role = 'HD'");
  if (search) { conditions.push("(u.name LIKE ? OR u.username LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  const [rows] = await pool.query(
    `
    SELECT u.id, u.name, u.username, u.role, u.city_id, c.name AS city_name, u.is_active,
      GROUP_CONCAT(DISTINCT s.id ORDER BY s.code SEPARATOR ',') AS segment_ids,
      GROUP_CONCAT(DISTINCT s.code ORDER BY s.code SEPARATOR ', ') AS segments,
      u.created_at
    FROM users u
    LEFT JOIN cities c ON c.id = u.city_id
    LEFT JOIN user_segments us ON us.user_id = u.id
    LEFT JOIN segments s ON s.id = us.segment_id
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    GROUP BY u.id, u.name, u.username, u.role, u.city_id, c.name, u.is_active, u.created_at
    ORDER BY u.name ASC
    `,
    params,
  );
  return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active), segment_ids: row.segment_ids ? row.segment_ids.split(",").map(Number) : [], segments: row.segments || "—" }));
}

async function getOptions(actorId) {
  const actor = await getActor(actorId);
  const [segments] = await pool.query("SELECT id, code FROM segments ORDER BY code");
  let cities = [];
  if (actor.role === "SUPER_ADMIN") [cities] = await pool.query("SELECT id, name FROM cities ORDER BY name");
  else [cities] = await pool.query("SELECT id, name FROM cities WHERE id = ?", [actor.city_id]);
  return { cities, segments, roles: actor.role === "SUPER_ADMIN" ? ["HD", "ADMIN"] : ["HD"] };
}

async function getTarget(connection, userId) {
  const [rows] = await connection.query("SELECT id, name, username, role, city_id FROM users WHERE id = ? FOR UPDATE", [userId]);
  if (!rows[0]) { const error = new Error("User tidak ditemukan"); error.statusCode = 404; throw error; }
  return rows[0];
}

async function replaceSegments(connection, userId, segmentIds) {
  await connection.query("DELETE FROM user_segments WHERE user_id = ?", [userId]);
  for (const segmentId of segmentIds || []) await connection.query("INSERT INTO user_segments (user_id, segment_id) VALUES (?, ?)", [userId, segmentId]);
}

async function createUser(actorId, payload) {
  const actor = await getActor(actorId);
  const role = payload.role || "HD";
  const cityId = payload.city_id || actor.city_id;
  validateScope(actor, { ...payload, role, city_id: cityId });
  if (!payload.name || !payload.username || typeof payload.password !== "string" || !payload.password.length) { const error = new Error("Nama, username, dan password wajib diisi"); error.statusCode = 400; throw error; }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const [result] = await connection.query("INSERT INTO users (name, username, password_hash, role, city_id, is_active) VALUES (?, ?, ?, ?, ?, 1)", [payload.name.trim(), payload.username.trim(), passwordHash, role, cityId]);
    if (role === "HD") await replaceSegments(connection, result.insertId, payload.segment_ids);
    await connection.commit();
    return { id: Number(result.insertId) };
  } catch (error) { await connection.rollback(); if (error.code === "ER_DUP_ENTRY") { error.message = "Username sudah digunakan"; error.statusCode = 409; } throw error; } finally { connection.release(); }
}

async function updateUser(actorId, userId, payload) {
  const actor = await getActor(actorId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const target = await getTarget(connection, userId);
    validateScope(actor, { ...payload, city_id: payload.city_id || target.city_id }, target);
    const role = payload.role || target.role;
    if (actor.role !== "SUPER_ADMIN" && role !== "HD") validateScope(actor, { role, city_id: target.city_id }, target);
    await connection.query("UPDATE users SET name = ?, username = ?, role = ?, city_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [payload.name?.trim() || target.name, payload.username?.trim() || target.username, role, payload.city_id || target.city_id, payload.is_active === undefined ? 1 : Number(Boolean(payload.is_active)), userId]);
    if (role === "HD" && payload.segment_ids) await replaceSegments(connection, userId, payload.segment_ids);
    if (role !== "HD") await replaceSegments(connection, userId, []);
    await connection.commit();
    return { id: Number(userId) };
  } catch (error) { await connection.rollback(); if (error.code === "ER_DUP_ENTRY") { error.message = "Username sudah digunakan"; error.statusCode = 409; } throw error; } finally { connection.release(); }
}

async function resetPassword(actorId, userId, password) {
  if (!password || password.length < 8) { const error = new Error("Password minimal 8 karakter"); error.statusCode = 400; throw error; }
  const actor = await getActor(actorId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const target = await getTarget(connection, userId);
    validateScope(actor, { city_id: target.city_id }, target);
    const hash = await bcrypt.hash(password, 10);
    await connection.query("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [hash, userId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function deleteUser(actorId, userId, username) {
  const targetId = Number(userId);
  if (!/^\d+$/.test(String(userId)) || !Number.isSafeInteger(targetId) || targetId < 1) {
    throw Object.assign(new Error("ID user tidak valid"), { statusCode: 400 });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Lock both accounts so a concurrent delete or role change cannot bypass the checks.
    const [users] = await connection.query(
      "SELECT id, username, role, is_active FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE",
      [actorId, targetId],
    );
    const actor = users.find((user) => Number(user.id) === Number(actorId));
    if (!actor?.is_active || actor.role !== "SUPER_ADMIN") {
      throw Object.assign(new Error("Hanya Super Admin yang dapat menghapus user"), { statusCode: 403 });
    }
    if (Number(actor.id) === targetId) {
      throw Object.assign(new Error("Anda tidak dapat menghapus akun sendiri"), { statusCode: 409 });
    }
    const target = users.find((user) => Number(user.id) === targetId);
    if (!target) throw Object.assign(new Error("User tidak ditemukan"), { statusCode: 404 });
    if (typeof username !== "string" || username.trim() !== target.username) {
      throw Object.assign(new Error("Ketik username akun dengan tepat untuk mengonfirmasi"), { statusCode: 400 });
    }
    const [[active]] = await connection.query(
      `SELECT o.id FROM orders o
       WHERE o.status <> 'DONE' AND (o.performance_owner_id = ? OR EXISTS (
         SELECT 1 FROM order_assignments oa WHERE oa.order_id = o.id AND oa.user_id = ? AND oa.released_at IS NULL
       )) LIMIT 1 FOR UPDATE`,
      [targetId, targetId],
    );
    if (active) {
      throw Object.assign(new Error(`Order #${active.id} masih aktif. Pindahkan atau selesaikan order sebelum menghapus akun.`), { statusCode: 409 });
    }

    // Only unlink the user. Order statuses, activity, results and attachments stay intact.
    await connection.query("UPDATE orders SET performance_owner_id = NULL WHERE performance_owner_id = ?", [targetId]);
    await connection.query("UPDATE order_assignments SET user_id = NULL WHERE user_id = ?", [targetId]);
    await connection.query("UPDATE order_events SET actor_user_id = NULL WHERE actor_user_id = ?", [targetId]);
    await connection.query("UPDATE order_events SET target_user_id = NULL WHERE target_user_id = ?", [targetId]);
    await connection.query("UPDATE order_notes SET user_id = NULL WHERE user_id = ?", [targetId]);
    await connection.query("UPDATE order_results SET user_id = NULL WHERE user_id = ?", [targetId]);
    await connection.query("DELETE ab FROM attendance_breaks ab JOIN attendance a ON a.id = ab.attendance_id WHERE a.user_id = ?", [targetId]);
    await connection.query("DELETE FROM attendance WHERE user_id = ?", [targetId]);
    await connection.query("DELETE FROM local_agents WHERE user_id = ?", [targetId]);
    await connection.query("DELETE FROM user_segments WHERE user_id = ?", [targetId]);
    await connection.query("DELETE FROM users WHERE id = ?", [targetId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      throw Object.assign(new Error("Akun masih terhubung ke data lain. Penghapusan dibatalkan."), { statusCode: 409 });
    }
    throw error;
  } finally { connection.release(); }
}

module.exports = { listUsers, getOptions, createUser, updateUser, resetPassword, deleteUser };
