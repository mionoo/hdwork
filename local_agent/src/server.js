require("dotenv").config();

const express = require("express");
const networkRoutes = require("./routes/network.routes");
const { connectAgent } = require("./socket/agent.socket");

const app = express();
const PORT = Number(process.env.PORT) || 5050;

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "HD Work Local Agent",
    status: "running",
  });
});

app.use("/api/network", networkRoutes);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`HD Work Local Agent running on http://127.0.0.1:${PORT}`);
  connectAgent();
});
