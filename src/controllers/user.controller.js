const userService = require("../services/user.service");

function respondError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({ success: false, message: error.message || fallback });
}

async function listUsers(req, res) {
  try { return res.json({ success: true, data: await userService.listUsers(req.user.id, { cityId: req.query.city_id, search: req.query.search }) }); }
  catch (error) { return respondError(res, error, "Gagal mengambil user"); }
}

async function getOptions(req, res) {
  try { return res.json({ success: true, data: await userService.getOptions(req.user.id) }); }
  catch (error) { return respondError(res, error, "Gagal mengambil opsi user"); }
}

async function createUser(req, res) {
  try { return res.status(201).json({ success: true, data: await userService.createUser(req.user.id, req.body) }); }
  catch (error) { return respondError(res, error, "Gagal membuat user"); }
}

async function updateUser(req, res) {
  try { return res.json({ success: true, data: await userService.updateUser(req.user.id, req.params.id, req.body) }); }
  catch (error) { return respondError(res, error, "Gagal mengubah user"); }
}

async function resetPassword(req, res) {
  try { await userService.resetPassword(req.user.id, req.params.id, req.body.password); return res.json({ success: true }); }
  catch (error) { return respondError(res, error, "Gagal reset password"); }
}

module.exports = { listUsers, getOptions, createUser, updateUser, resetPassword };
