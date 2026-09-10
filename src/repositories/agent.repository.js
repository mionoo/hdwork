const crypto = require("crypto");
const pool = require("../config/database");

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

async function getAdmin(userId) {
  const [rows] = await pool.query("SELECT id, role, city_id, is_active FROM users WHERE id = ?", [userId]);
  const user = rows[0];
  if (!user?.is_active || !["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    const error = new Error("Hanya admin yang dapat mengelola Local Agent"); error.statusCode = 403; throw error;
  }
  return user;
}

async function create(userId, { name, hd_user_id: hdUserId }) {
  const admin = await getAdmin(userId);
  const [users] = await pool.query("SELECT id, name, city_id, role, is_active FROM users WHERE id = ?", [hdUserId]);
  const hd = users[0];
  if (!hd?.is_active || hd.role !== "HD") { const error = new Error("HD tujuan tidak valid"); error.statusCode = 400; throw error; }
  if (admin.role === "ADMIN" && Number(admin.city_id) !== Number(hd.city_id)) { const error = new Error("Admin hanya dapat membuat agent untuk HD di kotanya"); error.statusCode = 403; throw error; }
  const agentKey = crypto.randomUUID();
  const token = `hdwa_${crypto.randomBytes(32).toString("base64url")}`;
  const [result] = await pool.query("INSERT INTO local_agents (agent_key, user_id, name, token_hash) VALUES (?, ?, ?, ?)", [agentKey, hd.id, name?.trim() || `Laptop ${hd.name}`, hashToken(token)]);
  return { id: Number(result.insertId), agent_key: agentKey, agent_token: token, user_id: hd.id, user_name: hd.name, name: name?.trim() || `Laptop ${hd.name}` };
}

async function createForHd(hdUserId, name) {
  const [users] = await pool.query("SELECT id, name, role, is_active FROM users WHERE id = ?", [hdUserId]);
  const hd = users[0];
  if (!hd?.is_active || hd.role !== "HD") { const error = new Error("Pairing hanya tersedia untuk akun HD aktif"); error.statusCode = 403; throw error; }
  const agentKey = crypto.randomUUID();
  const token = `hdwa_${crypto.randomBytes(32).toString("base64url")}`;
  const agentName = name?.trim() || `Laptop ${hd.name}`;
  await pool.query("INSERT INTO local_agents (agent_key, user_id, name, token_hash) VALUES (?, ?, ?, ?)", [agentKey, hd.id, agentName, hashToken(token)]);
  return { agent_id: agentKey, agent_token: token, name: agentName };
}

async function authenticate(agentKey, token) {
  const [rows] = await pool.query("SELECT id, agent_key, user_id, name FROM local_agents WHERE agent_key = ? AND token_hash = ? AND is_active = 1 LIMIT 1", [agentKey, hashToken(token || "")]);
  return rows[0] || null;
}

async function markConnected(id) { await pool.query("UPDATE local_agents SET last_seen_at=CURRENT_TIMESTAMP, connected_at=CURRENT_TIMESTAMP, disconnected_at=NULL WHERE id=?", [id]); }
async function markDisconnected(id) { await pool.query("UPDATE local_agents SET last_seen_at=CURRENT_TIMESTAMP, disconnected_at=CURRENT_TIMESTAMP WHERE id=?", [id]); }

module.exports = { create, createForHd, authenticate, markConnected, markDisconnected };
