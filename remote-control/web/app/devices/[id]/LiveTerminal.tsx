"use client";

import { useEffect, useRef, useState } from "react";
import { websocketBaseUrl } from "../../lib/api";

type LiveMessage =
  | {
      type: "output";
      commandId: string;
      chunk: string;
      deviceId?: string;
    }
  | {
      type: "command-start";
      commandId: string;
      command: string;
      deviceId?: string;
    };

export default function LiveTerminal({ deviceId }: { deviceId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [currentCommand, setCurrentCommand] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const ws = new WebSocket(websocketBaseUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "browser", deviceId }));
    };

    ws.onmessage = (event) => {
      try {
        const data: LiveMessage = JSON.parse(event.data);

        if (data.type === "command-start") {
          setCurrentCommand(data.command);
          setLines([]);
          return;
        }

        if (data.type === "output") {
          setLines((prev) => [...prev, data.chunk]);
        }
      } catch (err) {
        console.error("ws parse error", err);
      }
    };

    return () => {
      ws.close();
    };
  }, [deviceId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div style={terminal}>
      <h2 style={{ marginTop: 0 }}>Live Terminal</h2>
      <div style={{ marginBottom: "10px", color: "#93c5fd" }}>
        {currentCommand ? `$ ${currentCommand}` : "Waiting for command..."}
      </div>
      <pre ref={outputRef} style={pre}>
        {lines.length === 0 ? "Waiting for output..." : lines.join("")}
      </pre>
    </div>
  );
}

const terminal: React.CSSProperties = {
  border: "1px solid #111",
  background: "#000",
  color: "#0f0",
  padding: "12px",
  borderRadius: "8px",
};

const pre: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  fontFamily: "monospace",
  maxHeight: "320px",
  overflowY: "auto",
  margin: 0,
};
