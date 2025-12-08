import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import path from "path";
import { fileURLToPath } from "url";

// ==========================
// PATH FIX & BASIC SERVER SETUP
// ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, "public")));

// ==========================
// REDIS ADAPTER SETUP (DISTRIBUTED SYNC)
// ==========================
const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_URL = `redis://${REDIS_HOST}:6379`;

const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();

// Use a simple client for command execution (needed for PUBLISH/SUBSCRIBE)
const commandClient = pubClient.duplicate();

try {
  await Promise.all([
    pubClient.connect(),
    subClient.connect(),
    commandClient.connect(),
  ]);
  console.log("✅ Connected to Redis at", REDIS_HOST);
} catch (error) {
  console.error("❌ Failed to connect to Redis:", error.message);
  process.exit(1);
}

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});
io.adapter(createAdapter(pubClient, subClient));

// ==========================
// BOARD STATE IN MEMORY (TEMPORARY/SIMPLE CACHE)
// ==========================
// WARNING: This array holds the board state. It requires synchronization via Redis Pub/Sub.
let strokes = [];
// each item: { x, y, color, userId }

// ==========================
// REDIS → SOCKET BROADCAST (The synchronization engine)
// ==========================
subClient.subscribe("whiteboard-events", (message) => {
  const msg = JSON.parse(message);

  if (msg.type === "draw") {
    strokes.push(msg.data);
    io.emit("draw", msg.data);
  }

  if (msg.type === "clear-all") {
    strokes = [];
    io.emit("clear-all");
  }

  if (msg.type === "clear-user") {
    const targetUser = msg.userId;
    // Filter out the strokes from the target user
    strokes = strokes.filter((s) => s.userId !== targetUser);

    // Tell all clients to fully redraw the filtered state
    io.emit("reset-board", strokes);
  }
});

// ==========================
// SOCKET.IO USER HANDLING
// ==========================
io.on("connection", (socket) => {
  let userId = null;

  console.log("🟢 Socket connected:", socket.id);

  // 1. Client sends its session userId
  socket.on("register", (data) => {
    userId = data?.userId || socket.id.slice(0, 5).toUpperCase();

    console.log("👤 User registered:", socket.id, "userId:", userId);

    // Send back user info & the current board state
    socket.emit("user-info", { userId });
    socket.emit("init-board", strokes);
  });

  // 2. DRAW EVENT: Publish to Redis (Server A draws, Server B, C subscribes)
  socket.on("draw", (data) => {
    const withUser = { ...data, userId };

    // Use Redis PUBLISH to send the stroke data to all other nodes
    commandClient.publish(
      "whiteboard-events",
      JSON.stringify({ type: "draw", data: withUser })
    );
  });

  // 3. CLEAR ALL EVENT
  socket.on("clear-all", () => {
    commandClient.publish(
      "whiteboard-events",
      JSON.stringify({ type: "clear-all" })
    );
  });

  // 4. CLEAR ONLY MY STROKES
  socket.on("clear-mine", () => {
    commandClient.publish(
      "whiteboard-events",
      JSON.stringify({ type: "clear-user", userId })
    );
  });

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id, "userId:", userId);
  });
});

// ==========================
// START SERVER
// ==========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`✅ Whiteboard running at http://localhost:${PORT}`);
});
