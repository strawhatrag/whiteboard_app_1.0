import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import * as Y from "yjs";

// Connect to Node 1 by default
const socket = io("http://localhost:3001");

function App() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [status, setStatus] = useState("Connecting...");

  // Yjs State (CRDTs)
  const ydoc = useRef(new Y.Doc());
  const yLines = useRef(ydoc.current.getArray("lines"));

  useEffect(() => {
    socket.on("connect", () =>
      setStatus(`Connected to Cloud Node: ${socket.id}`)
    );
    socket.on("disconnect", () => setStatus("Disconnected"));

    // Sync Logic
    socket.on("sync-initial", (update) => {
      Y.applyUpdate(ydoc.current, new Uint8Array(update));
      drawCanvas();
    });

    socket.on("sync-update", (update) => {
      Y.applyUpdate(ydoc.current, new Uint8Array(update));
      drawCanvas();
    });

    yLines.current.observe(() => {
      drawCanvas();
    });

    return () => {
      socket.off("connect");
      socket.off("sync-initial");
      socket.off("sync-update");
    };
  }, []);

  const startDrawing = (e) => {
    setIsDrawing(true);
    const { offsetX, offsetY } = e.nativeEvent;
    const newLine = { points: [offsetX, offsetY], color: "#000" };
    yLines.current.push([newLine]);
    broadcastUpdate();
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = e.nativeEvent;
    const lastLineIndex = yLines.current.length - 1;
    const currentLine = yLines.current.get(lastLineIndex);
    const updatedPoints = [...currentLine.points, offsetX, offsetY];

    ydoc.current.transact(() => {
      yLines.current.delete(lastLineIndex);
      yLines.current.push([{ ...currentLine, points: updatedPoints }]);
    });

    broadcastUpdate();
  };

  const endDrawing = () => {
    setIsDrawing(false);
    broadcastUpdate();
  };

  const broadcastUpdate = () => {
    const update = Y.encodeStateAsUpdate(ydoc.current);
    socket.emit("sync-update", update);
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    yLines.current.forEach((line) => {
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 3;
      const points = line.points;
      if (points.length > 0) {
        ctx.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) {
          ctx.lineTo(points[i], points[i + 1]);
        }
      }
      ctx.stroke();
    });
  };

  return (
    <div style={{ textAlign: "center", fontFamily: "Arial" }}>
      <h1>Cloud Whiteboard</h1>
      <p>
        Status: <strong>{status}</strong>
      </p>
      <canvas
        ref={canvasRef}
        width={800}
        height={500}
        style={{ border: "2px solid #333", cursor: "crosshair" }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={endDrawing}
        onMouseLeave={endDrawing}
      />
    </div>
  );
}

export default App;
