import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import * as Y from "yjs"; // Must be 'import * as Y'
import { v4 as uuidv4 } from "uuid";
import { RefreshCw, Zap, Trash2, GitCommit } from "lucide-react";

// NOTE: Using a static URL for local test
const SOCKET_URL = "http://localhost:3001";

// Connect outside component to prevent multiple connections
const socket = io(SOCKET_URL);

// --- YJS STATE INITIALIZATION ---
// Create the shared document
const ydoc = new Y.Doc();
const yLines = ydoc.getArray("lines");

const App = () => {
  console.log("App is rendering..."); // Check your F12 Console for this!

  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [nodeId, setNodeId] = useState("");
  const [currentColor, setCurrentColor] = useState("#000000");
  const [currentStroke, setCurrentStroke] = useState(3);

  // --- Synchronization and Initial Setup ---
  useEffect(() => {
    console.log("Setting up socket listeners...");

    socket.on("connect", () => {
      console.log("Connected to server!", socket.id);
      setStatus(`Connected`);
      setNodeId(socket.id);
    });

    socket.on("disconnect", () => setStatus("Disconnected"));

    socket.on("sync-initial", (update) => {
      console.log("Received initial state");
      Y.applyUpdate(ydoc, new Uint8Array(update));
      drawCanvas();
    });

    socket.on("sync-update", (update) => {
      Y.applyUpdate(ydoc, new Uint8Array(update));
      drawCanvas();
    });

    yLines.observe(drawCanvas);

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("sync-initial");
      socket.off("sync-update");
      yLines.unobserve(drawCanvas);
    };
  }, []);

  const broadcastUpdate = useCallback(() => {
    const update = Y.encodeStateAsUpdate(ydoc);
    socket.emit("sync-update", update);
  }, []);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    yLines.toArray().forEach((line) => {
      ctx.beginPath();
      ctx.strokeStyle = line.color || "#000";
      ctx.lineWidth = line.stroke || 3;

      const points = line.points;
      if (points.length > 0) {
        ctx.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) {
          ctx.lineTo(points[i], points[i + 1]);
        }
      }
      ctx.stroke();
    });
  }, []);

  // --- Event Handlers (Drawing) ---
  const startDrawing = (e) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDrawing(true);
    const { offsetX, offsetY } = e.nativeEvent;

    const newLine = {
      id: uuidv4(),
      points: [offsetX, offsetY],
      color: currentColor,
      stroke: currentStroke,
    };

    yLines.push([newLine]);
    broadcastUpdate();
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = e.nativeEvent;

    const lastLineIndex = yLines.length - 1;
    if (lastLineIndex < 0) return;

    const currentLine = yLines.get(lastLineIndex);
    if (!currentLine) return;

    ydoc.transact(() => {
      yLines.delete(lastLineIndex);
      const updatedPoints = [...currentLine.points, offsetX, offsetY];
      yLines.insert(lastLineIndex, [{ ...currentLine, points: updatedPoints }]);
    });

    broadcastUpdate();
  };

  const endDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    broadcastUpdate();
  };

  const handleClear = () => {
    ydoc.transact(() => {
      yLines.delete(0, yLines.length);
    });
    broadcastUpdate();
  };

  const canvasWidth = 800;
  const canvasHeight = 600;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4 font-inter">
      <div className="w-full max-w-4xl bg-white shadow-xl rounded-xl p-6">
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-bold text-gray-800 flex items-center justify-center">
            <Zap className="mr-3 text-indigo-600 h-8 w-8" />
            Distributed Cloud Whiteboard
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            Status:{" "}
            <span
              className={`font-semibold ${
                status === "Connected" ? "text-green-600" : "text-red-600"
              }`}
            >
              {status}
            </span>
            <span className="ml-4 text-xs">
              Node ID: {nodeId.substring(0, 10)}...
            </span>
          </p>
        </header>

        {/* Toolbar */}
        <div className="flex justify-center space-x-4 p-3 bg-gray-100 rounded-lg mb-4 shadow-inner">
          <label className="flex items-center text-sm font-medium text-gray-700">
            Color:
            <input
              type="color"
              value={currentColor}
              onChange={(e) => setCurrentColor(e.target.value)}
              className="ml-2 h-8 w-8 rounded-md border-gray-300"
            />
          </label>
          <label className="flex items-center text-sm font-medium text-gray-700">
            Stroke:
            <input
              type="range"
              min="1"
              max="15"
              value={currentStroke}
              onChange={(e) => setCurrentStroke(parseInt(e.target.value))}
              className="ml-2 w-24 appearance-none h-2 bg-gray-300 rounded-lg"
            />
            <span className="ml-2 text-base">{currentStroke}px</span>
          </label>
          <button
            onClick={handleClear}
            className="flex items-center px-4 py-2 bg-red-500 text-white font-semibold rounded-lg shadow-md hover:bg-red-600 transition duration-150"
          >
            <Trash2 className="h-4 w-4 mr-1" /> Clear All
          </button>
        </div>

        {/* Canvas */}
        <div className="flex justify-center border-4 border-indigo-600 rounded-lg overflow-hidden">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className="bg-white touch-none"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={endDrawing}
            onMouseLeave={endDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={endDrawing}
          />
        </div>

        <footer className="mt-6 text-center text-gray-500 text-sm">
          <p>
            <GitCommit className="inline h-4 w-4 mr-1" />
            This application uses **Node.js Agents** and **Redis Pub/Sub** to
            ensure real-time consistency.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;
