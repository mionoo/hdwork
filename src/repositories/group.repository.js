const pool = require("../config/database");

async function actor(userId) {
  const [rows] = await pool.query("SELECT id, role, city_id, is_active FROM users WHERE id = ?", [userId]);
  const user = rows[0];
  if (!user?.is_active || !["ADMIN", "SUPER_ADMIN"].includes(user.role)) { const error = new Error("Hanya admin yang dapat mengelola grup"); error.statusCode = 403; throw error; }
  return user;
}
async function groupForActor(connection, user, id) {
  const [rows] = await connection.query("SELECT id, city_id, name FROM telegram_groups WHERE id = ? FOR UPDATE", [id]);
  const group = rows[0];
  if (!group) { const error = new Error("Grup tidak ditemukan"); error.statusCode = 404; throw error; }
  if (user.role === "ADMIN" && Number(group.city_id) !== Number(user.city_id)) { const error = new Error("Anda hanya dapat mengelola grup di kota sendiri"); error.statusCode = 403; throw error; }
  return group;
}
async function list(userId, cityId) {
  const user = await actor(userId); const effectiveCity = user.role === "ADMIN" ? user.city_id : cityId || null;
  const [rows] = await pool.query(`SELECT tg.id,tg.name,tg.telegram_chat_id,tg.telegram_thread_id,tg.city_id,c.name AS city_name,tg.segment_id,s.code AS segment_code,tg.category,tg.is_active,COUNT(o.id) AS order_count FROM telegram_groups tg JOIN cities c ON c.id=tg.city_id JOIN segments s ON s.id=tg.segment_id LEFT JOIN orders o ON o.telegram_group_id=tg.id ${effectiveCity?"WHERE tg.city_id = ?":""} GROUP BY tg.id,tg.name,tg.telegram_chat_id,tg.telegram_thread_id,tg.city_id,c.name,tg.segment_id,s.code,tg.category,tg.is_active ORDER BY c.name,tg.name`, effectiveCity?[effectiveCity]:[]);
  return rows.map(row=>({...row,is_active:Boolean(row.is_active),order_count:Number(row.order_count)}));
}
async function options(userId) { const user=await actor(userId); const [segments]=await pool.query("SELECT id,code FROM segments ORDER BY code"); const [cities]=await pool.query(user.role==="SUPER_ADMIN"?"SELECT id,name FROM cities ORDER BY name":"SELECT id,name FROM cities WHERE id = ?",user.role==="SUPER_ADMIN"?[]:[user.city_id]); return {cities,segments}; }
async function update(userId,id,payload) { const user=await actor(userId); const connection=await pool.getConnection(); try { await connection.beginTransaction(); const group=await groupForActor(connection,user,id); const cityId=user.role==="ADMIN"?group.city_id:payload.city_id||group.city_id; await connection.query("UPDATE telegram_groups SET name=?, city_id=?, segment_id=?, category=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",[payload.name?.trim()||group.name,cityId,payload.segment_id,payload.category,Number(Boolean(payload.is_active)),id]); await connection.commit(); } catch(error){await connection.rollback();throw error;} finally{connection.release();} }
async function remove(userId,id) { const user=await actor(userId); const connection=await pool.getConnection(); try { await connection.beginTransaction(); await groupForActor(connection,user,id); const [orders]=await connection.query("SELECT COUNT(*) AS total FROM orders WHERE telegram_group_id = ?",[id]); if(Number(orders[0].total)>0){const error=new Error("Grup sudah memiliki riwayat order dan tidak dapat dihapus permanen. Nonaktifkan grup sebagai gantinya.");error.statusCode=409;throw error;} await connection.query("DELETE FROM telegram_groups WHERE id=?",[id]);await connection.commit(); }catch(error){await connection.rollback();throw error;}finally{connection.release();} }
module.exports={list,options,update,remove};
