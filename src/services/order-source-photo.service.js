const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// Deliberately outside /uploads: source photos must pass order authorization.
const storage = path.resolve(__dirname, "../../storage/order-source");
const inFlight = new Map();
const MAX_BYTES = 20 * 1024 * 1024;

async function ensureTelegramFile(file, telegram, conversation = false) {
  const id = String(file.id);
  if (!/^\d+$/.test(id)) throw new Error("ID lampiran tidak valid");
  if (Number(file.file_size) > MAX_BYTES) {
    throw Object.assign(new Error("Lampiran melebihi batas unduhan Telegram (20 MB)."), { statusCode: 413 });
  }
  const directory = conversation ? path.join(storage, "conversation") : storage;
  const filename = path.join(directory, id + (conversation ? ".bin" : ".jpg"));
  if (fs.existsSync(filename)) return filename;
  if (inFlight.has(filename)) return inFlight.get(filename);
  const task = (async () => {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, id + "-" + crypto.randomUUID() + ".tmp");
    try {
      const url = await telegram.getFileLink(file.file_id);
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
      if (!response.ok || !response.body) throw new Error("Unduhan lampiran gagal");
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(bytes > MAX_BYTES ? new Error("Lampiran melebihi batas ukuran") : null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      if (!bytes) throw new Error("Lampiran kosong");
      await fs.promises.rename(temporary, filename);
      return filename;
    } catch {
      // Telegram's download URL contains the bot token: never expose its error.
      await fs.promises.unlink(temporary).catch(() => {});
      throw Object.assign(new Error("Lampiran belum dapat dimuat. Silakan coba lagi."), { statusCode: 502 });
    }
  })();
  inFlight.set(filename, task);
  try { return await task; } finally { inFlight.delete(filename); }
}

const ensurePhoto = (photo, telegram) => ensureTelegramFile(photo, telegram);

module.exports = { ensurePhoto, ensureTelegramFile };
