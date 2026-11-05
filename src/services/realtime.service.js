let io = null;

function initialize(socketServer) {
  io = socketServer;
}

function emitOrdersChanged() {
  io?.emit("orders:changed");
}

function disconnectUser(userId) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

module.exports = { initialize, emitOrdersChanged, disconnectUser };
