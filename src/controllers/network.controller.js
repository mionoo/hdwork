const networkService = require("../services/network.service");

async function ping(req, res) {
  try {
    const { host } = req.body;

    if (!host) {
      return res.status(400).json({
        success: false,
        message: "Host wajib diisi",
      });
    }

    const result = await networkService.pingHost(req.user.id, host);

    return res.status(200).json({
      success: true,
      message: "Ping berhasil dijalankan",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Gagal menjalankan ping",
    });
  }
}

async function sshTest(req, res) {
  try {
    const { host, port, username, password, trust_host: trustHost } = req.body;
    if (!host) {
      return res.status(400).json({ success: false, message: "Host wajib diisi" });
    }
    if (trustHost && (!username || !password)) {
      return res.status(400).json({ success: false, message: "Username dan password wajib diisi setelah host dipercaya" });
    }

    const result = await networkService.testSshConnection(req.user.id, {
      host,
      port: Number(port) || 22,
      username,
      password,
      trust_host: Boolean(trustHost),
    });

    return res.status(200).json({ success: true, message: "SSH connection test selesai", data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Gagal menjalankan SSH connection test" });
  }
}

async function status(req, res) {
  const data = await networkService.getAgentStatus(req.user.id);
  return res.status(200).json({ success: true, data });
}

async function vpnHealth(req, res) {
  try {
    const data = await networkService.checkVpnPath(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Gagal memeriksa jalur VPN" });
  }
}

module.exports = {
  ping,
  sshTest,
  status,
  vpnHealth,
};
