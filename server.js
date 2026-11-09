require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const { authenticateToken } = require("./src/services/auth.service");
const app = require("./src/app");
const pool = require("./src/config/database");
const telegramService = require("./src/services/telegram.service");
const realtimeService = require("./src/services/realtime.service");
const agentRealtimeService = require("./src/services/agent-realtime.service");
const terminalRealtimeService = require("./src/services/terminal-realtime.service");
const { CACTI_ENABLED } = require("./src/config/features");
const cactiScheduler = CACTI_ENABLED ? require("./src/services/cacti-scheduler.service") : null;

const PORT = Number(process.env.PORT) || 3090;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN } });
const SHUTDOWN_TIMEOUT_MS = 5000;
let shuttingDown = false;

io.use(async (socket, next) => {
  try {
    const user = await authenticateToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("Unauthorized"));
    socket.data.user = user;
    await socket.join(`user:${user.id}`);
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

realtimeService.initialize(io);
agentRealtimeService.initialize(io);
terminalRealtimeService.initialize(io);

async function startServer() {
  const connection = await pool.getConnection();
  connection.release();
  if (shuttingDown) return;
  console.log("✅ MySQL connected");

  server.listen(PORT, () => {
    if (shuttingDown) return;
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    if (cactiScheduler) cactiScheduler.startCactiScheduler();
    else console.log("Cacti nonaktif: scheduler, integrasi, dan notifikasi dinonaktifkan.");
    telegramService.startPolling()?.catch((error) => {
      console.error("Pengendali polling Telegram gagal:", error.message);
    });
  });
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Menghentikan backend (${reason})`);
  const deadline = setTimeout(() => {
    console.error("Waktu penghentian backend habis");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    cactiScheduler?.stopCactiScheduler();
    await Promise.all([
      telegramService.stopPolling(reason),
      new Promise((resolve, reject) => {
        io.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        }).catch(reject);
      }),
    ]);
    await pool.end();
  } catch (error) {
    console.error("Penghentian backend gagal:", error.message);
    exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.exit(exitCode);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
server.once("error", (error) => {
  console.error("Server HTTP gagal:", error.message);
  void shutdown("HTTP error", 1);
});
startServer().catch((error) => {
  console.error("Koneksi MySQL gagal:", error.message);
  void shutdown("MySQL error", 1);
});
