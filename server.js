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
// REDIS SETUP (DB & SYNC)
// ==========================
const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_URL = `redis://${REDIS_HOST}:6379`;
const REDIS_KEY = "whiteboard:strokes"; // Key for the persistent stroke list in Redis

const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();
const dbClient = pubClient.duplicate(); // Separate client for DB List operations

try {
  // Connect all three clients for different roles (pub, sub, db)
  await Promise.all([
    pubClient.connect(),
    subClient.connect(),
    dbClient.connect(),
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
// REDIS UTILITIES (For Loading/Saving State)
// ==========================

/** Retrieves all strokes from Redis List and parses them. */
async function getFullBoardState() {
  try {
    // LRANGE 0 -1 fetches the entire list.
    const strokeStrings = await dbClient.lRange(REDIS_KEY, 0, -1);
    // Reverse the list because LPUSH (used for saving) adds to the head.
    return strokeStrings.reverse().map((s) => JSON.parse(s));
  } catch (e) {
    console.error("Error retrieving board state from Redis:", e);
    return [];
  }
}

// ==========================
// SOCKET.IO USER HANDLING
// ==========================
io.on("connection", async (socket) => {
  // NOTE: async is critical for Redis commands
  let userId = null;

  socket.on("register", async (data) => {
    userId = data?.userId || socket.id.slice(0, 5).toUpperCase();

    socket.emit("user-info", { userId });

    // 1. Send the full persistent state to the new user
    const strokes = await getFullBoardState();
    socket.emit("init-board", strokes);

    console.log(
      `👤 User ${userId} registered and received ${strokes.length} strokes.`
    );
  });

  // 2. DRAW EVENT: Save the stroke to Redis List and broadcast
  socket.on("draw", async (data) => {
    const withUser = { ...data, userId };
    const strokeString = JSON.stringify(withUser);

    // Save stroke to Redis List (LPUSH is highly performant)
    await dbClient.lPush(REDIS_KEY, strokeString);

    // Broadcast the drawing to everyone *except* the sender (who already drew locally)
    socket.broadcast.emit("draw", withUser);
  });

  // 3. CLEAR ALL EVENT: Clear Redis and notify clients
  socket.on("clear-all", async () => {
    await dbClient.del(REDIS_KEY); // Delete the entire persistent list
    io.emit("clear-all");
    console.log(`🗑️ Board fully cleared by ${userId}.`);
  });

  // 4. CLEAR ONLY MY STROKES: Filter strokes by userId
  socket.on("clear-mine", async () => {
    const targetUser = userId;

    // Fetch all strokes from persistent store
    const strokes = await getFullBoardState();

    // Filter out the target user's strokes
    const remainingStrokes = strokes.filter((s) => s.userId !== targetUser);

    // Delete the old list and push the filtered strokes back (re-persist)
    await dbClient.del(REDIS_KEY);

    if (remainingStrokes.length > 0) {
      const remainingStrings = remainingStrokes.map((s) => JSON.stringify(s));
      // RPUSH adds elements to the tail (end) of the list
      await dbClient.rPush(REDIS_KEY, remainingStrings);
    }

    // Tell all clients to clear their board and redraw the filtered state
    io.emit("reset-board", remainingStrokes);
    console.log(
      `🧹 User ${userId} cleared their strokes. ${remainingStrokes.length} remaining.`
    );
  });

  socket.on("disconnect", () => {
    // ... (standard logging)
  });
});

// ==========================
// START SERVER
// ==========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`✅ Whiteboard running at http://localhost:${PORT}`);
});
