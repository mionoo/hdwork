let io = null;

function initialize(socketServer) {
  io = socketServer;
}

function emitOrdersChanged() {
  io?.emit("orders:changed");
}

module.exports = { initialize, emitOrdersChanged };
