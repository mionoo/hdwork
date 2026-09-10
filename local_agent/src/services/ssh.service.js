const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const knownHostsPath = path.join(__dirname, "../../data/known_hosts.json");

function readKnownHosts() {
  try { return JSON.parse(fs.readFileSync(knownHostsPath, "utf8")); } catch { return {}; }
}

function saveKnownHost(hostKey, fingerprint) {
  const knownHosts = readKnownHosts();
  knownHosts[hostKey] = { fingerprint, trusted_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(knownHostsPath), { recursive: true });
  const temporaryPath = `${knownHostsPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(knownHosts, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, knownHostsPath);
}

function fingerprintHostKey(key) {
  return `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function createHostVerifier({ host, port, trustHost, setVerification }) {
  const hostKey = `${host}:${Number(port)}`;
  return (key) => {
    const fingerprint = fingerprintHostKey(key);
    const knownHost = readKnownHosts()[hostKey];
    if (knownHost && knownHost.fingerprint !== fingerprint) {
      setVerification({ host_key_changed: true, fingerprint, message: "Fingerprint host berubah. Koneksi diblokir demi keamanan." });
      return false;
    }
    if (!knownHost && !trustHost) {
      setVerification({ requires_host_confirmation: true, fingerprint, message: "Host baru terdeteksi. Konfirmasi fingerprint sebelum melanjutkan." });
      return false;
    }
    if (!knownHost) saveKnownHost(hostKey, fingerprint);
    return true;
  };
}

function testSshConnection({ host, port = 22, username, password, trust_host: trustHost = false }) {
  return new Promise((resolve) => {
    const connection = new Client();
    const startedAt = Date.now();
    let verification = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      connection.end();
      resolve({ host, port: Number(port), ...result, duration_ms: Date.now() - startedAt });
    };

    connection.on("ready", () => finish({ success: true, connected: true }));
    connection.on("error", () => {
      if (verification) return finish({ success: false, connected: false, ...verification });
      return finish({ success: false, connected: false, message: "Koneksi atau autentikasi SSH gagal" });
    });

    try {
      connection.connect({
        host,
        port: Number(port),
        username: username || "host-verification",
        password,
        readyTimeout: 10_000,
        hostVerifier: createHostVerifier({ host, port, trustHost, setVerification: (result) => { verification = result; } }),
      });
    } catch {
      finish({ success: false, connected: false, message: "Konfigurasi SSH tidak valid" });
    }
  });
}

module.exports = { testSshConnection, createHostVerifier };
