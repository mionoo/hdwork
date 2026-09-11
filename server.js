require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const app = require("./src/app");
const pool = require("./src/config/database");
const telegramService = require("./src/services/telegram.service");
const realtimeService = require("./src/services/realtime.service");
const agentRealtimeService = require("./src/services/agent-realtime.service");
const terminalRealtimeService = require("./src/services/terminal-realtime.service");

const PORT = Number(process.env.PORT) || 3090;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN } });

io.use((socket, next) => {
  try {
    socket.data.user = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

realtimeService.initialize(io);
agentRealtimeService.initialize(io);
terminalRealtimeService.initialize(io);

async function startServer() {
  try {
    const connection = await pool.getConnection();

    console.log("✅ MySQL connected");

    connection.release();

    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      telegramService.startPolling();
    });
  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(error.message);

    process.exit(1);
  }
}

startServer();
