const pool = require("../config/database");

async function actor(userId) {
  const [rows] = await pool.query("SELECT id, role, city_id, is_active FROM users WHERE id = ?", [userId]);
  const user = rows[0];
  if (!user?.is_active || !["ADMIN", "SUPER_ADMIN"].includes(user.role)) { const error = new Error("Hanya admin yang dapat mengelola grup"); error.statusCode = 403; throw error; }
  return user;
}
async function groupForActor(connection, user, id) {
  const [rows] = await connection.query("SELECT id, city_id, name, archived_at FROM telegram_groups WHERE id = ? FOR UPDATE", [id]);
  const group = rows[0];
  if (!group) { const error = new Error("Grup tidak ditemukan"); error.statusCode = 404; throw error; }
  if (user.role === "ADMIN" && Number(group.city_id) !== Number(user.city_id)) { const error = new Error("Anda hanya dapat mengelola grup di kota sendiri"); error.statusCode = 403; throw error; }
  return group;
}
function requireSuperAdmin(user) {
  if (user.role !== "SUPER_ADMIN") {
    throw Object.assign(new Error("Hanya Super Admin yang dapat mengelola arsip grup"), { statusCode: 403 });
  }
}
async function list(userId, cityId, archived = false) {
  const user = await actor(userId);
  if (archived) requireSuperAdmin(user);
  if (user.role === "ADMIN" && !user.city_id) return [];
  const effectiveCity = user.role === "ADMIN" ? user.city_id : cityId || null;
  const [rows] = await pool.query(
    `SELECT tg.id,tg.name,tg.telegram_chat_id,tg.telegram_thread_id,tg.city_id,c.name AS city_name,
       tg.segment_id,s.code AS segment_code,tg.category,tg.workflow,tg.is_active,
       tg.archived_at,COUNT(o.id) AS order_count
     FROM telegram_groups tg JOIN cities c ON c.id=tg.city_id JOIN segments s ON s.id=tg.segment_id
     LEFT JOIN orders o ON o.telegram_group_id=tg.id
     WHERE tg.archived_at IS ${archived ? "NOT NULL" : "NULL"} ${effectiveCity ? "AND tg.city_id = ?" : ""}
     GROUP BY tg.id,tg.name,tg.telegram_chat_id,tg.telegram_thread_id,tg.city_id,c.name,
       tg.segment_id,s.code,tg.category,tg.workflow,tg.is_active,tg.archived_at
     ORDER BY c.name,tg.name,tg.id`,
    effectiveCity ? [effectiveCity] : [],
  );
  return rows.map(row=>({...row,is_active:Boolean(row.is_active),order_count:Number(row.order_count)}));
}
async function options(userId) { const user=await actor(userId); const [segments]=await pool.query("SELECT id,code FROM segments ORDER BY code"); const [cities]=await pool.query(user.role==="SUPER_ADMIN"?"SELECT id,name FROM cities ORDER BY name":"SELECT id,name FROM cities WHERE id = ?",user.role==="SUPER_ADMIN"?[]:[user.city_id]); return {cities,segments}; }
async function update(userId,id,payload) { const user=await actor(userId); const connection=await pool.getConnection(); try { await connection.beginTransaction(); const group=await groupForActor(connection,user,id); const workflow=payload.workflow;
  if (group.archived_at) {
    throw Object.assign(new Error("Pulihkan grup dari arsip sebelum mengedit"), { statusCode: 409 });
  }
  if (workflow !== undefined && workflow !== null && !["ASSURANCE","PROVISIONING"].includes(workflow)) {
    throw Object.assign(new Error("Alur kerja tidak valid"), { statusCode: 400 });
  }
  const cityId=user.role==="ADMIN"?group.city_id:payload.city_id||group.city_id; await connection.query("UPDATE telegram_groups SET name=?, city_id=?, segment_id=?, category=?, workflow=IF(?, ?, workflow), is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",[payload.name?.trim()||group.name,cityId,payload.segment_id,payload.category,workflow !== undefined,workflow ?? null,Number(Boolean(payload.is_active)),id]); await connection.commit(); } catch(error){await connection.rollback();throw error;} finally{connection.release();} }
async function setArchived(userId, id, archived) {
  requireSuperAdmin(await actor(userId));
  const [result] = await pool.query(
    `UPDATE telegram_groups
     SET archived_at = ${archived ? "COALESCE(archived_at, CURRENT_TIMESTAMP)" : "NULL"},
         is_active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND city_id IS NOT NULL AND segment_id IS NOT NULL
       AND category IN ('PENGAWALAN', 'LOGIC')${archived ? "" : " AND archived_at IS NOT NULL"}`,
    [id],
  );
  if (!result.affectedRows) {
    throw Object.assign(new Error(archived ? "Grup order tidak ditemukan" : "Grup tidak ditemukan di arsip"), { statusCode: 404 });
  }
}

module.exports = { list, options, update, setArchived };
