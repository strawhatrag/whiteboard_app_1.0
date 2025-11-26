const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");
const Y = require("yjs");

// Allow PORT to be set by command line (for running multiple nodes)
const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // 1. Connect to Redis (The "Shared Brain")
  const pubClient = createClient({ url: REDIS_URL });
  const subClient = pubClient.duplicate();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log(`✅ Connected to Redis at ${REDIS_URL}`);
  } catch (err) {
    console.error(
      "❌ Redis Error: Is Redis running? (docker run -p 6379:6379 redis)"
    );
    process.exit(1);
  }

  // 2. Setup Socket.IO with Redis Adapter
  const io = new Server(server, {
    cors: { origin: "*" }, // Allow React to connect
  });

  // This makes this server "Distributed"
  io.adapter(createAdapter(pubClient, subClient));

  // 3. The "Agentic" State (Yjs)
  const ydoc = new Y.Doc();

  io.on("connection", (socket) => {
    console.log(`[Node ${PORT}] User connected: ${socket.id}`);

    // Send current state to new user (Consistency)
    const state = Y.encodeStateAsUpdate(ydoc);
    socket.emit("sync-initial", state);

    // Listen for updates and apply them
    socket.on("sync-update", (update) => {
      Y.applyUpdate(ydoc, new Uint8Array(update));

      // Broadcast to other users (and other Nodes via Redis)
      socket.broadcast.emit("sync-update", update);
    });
  });

  server.listen(PORT, () => {
    console.log(`🚀 Cloud Node running on port ${PORT}`);
  });
}

startServer();
