"use client";

import { useState } from "react";
import { apiBaseUrl } from "../../lib/api";

export default function CommandForm({ deviceId }: { deviceId: string }) {
  const [command, setCommand] = useState("date");
  const [status, setStatus] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Sending...");

    try {
      const res = await fetch(
        `${apiBaseUrl()}/api/devices/${deviceId}/commands`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ command }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error || "Failed to send command");
        return;
      }

      setStatus(`Queued: ${data.commandId}`);
      setCommand("date");
    } catch {
      setStatus("Request failed");
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Send Command</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter command"
          style={input}
          autoFocus
        />
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button type="submit" style={button}>
            Send
          </button>
        </div>
      </form>
      {status && <p style={{ marginTop: "10px" }}>{status}</p>}
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%",
  maxWidth: "400px",
  padding: "10px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  marginBottom: "10px",
  display: "block",
};

const button: React.CSSProperties = {
  padding: "10px 16px",
  border: "none",
  borderRadius: "6px",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
};
