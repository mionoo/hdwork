const agentRepository = require("../repositories/agent.repository");
const agentRealtime = require("../services/agent-realtime.service");

async function create(req, res) {
  try {
    const agent = await agentRepository.create(req.user.id, req.body);
    return res.status(201).json({ success: true, message: "Local Agent dibuat. Simpan token ini; token hanya ditampilkan sekali.", data: agent });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Gagal membuat Local Agent" });
  }
}

async function pair(req, res) {
  try {
    const result = await agentRealtime.pairAgent(req.user.id, req.body.pairing_code);
    return res.status(200).json({ success: true, message: "Local Agent berhasil dipasangkan", data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Gagal memasangkan Local Agent" });
  }
}

module.exports = { create, pair };
