import React from 'react';
import { formatDate, shortText, statusBadge } from '../statusStyles';

type CommandResult = {
  command_id: string;
  device_id?: string;
  command: string;
  status: string;
  command_created_at: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  exit_code?: number | null;
  stdout_preview?: string | null;
  stderr_preview?: string | null;
  error_message?: string | null;
  duration_ms?: number | null;
  result_id?: string | null;
  output: string | null;
};

export default function CommandResults({
  results,
}: {
  results: CommandResult[];
}) {
  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Command History</h2>

      {results.length === 0 ? (
        <p style={empty}>No commands yet.</p>
      ) : (
        results.map((item) => (
          <div key={`${item.command_id}-${item.result_id ?? "no-result"}`} style={block}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <strong>$ {item.command}</strong>
              <span style={statusBadge(item.status)}>{item.status}</span>
            </div>
            <div style={meta}>
              Created: {formatDate(item.command_created_at)} | Started: {formatDate(item.started_at)} | Completed: {formatDate(item.completed_at)}
            </div>
            <div style={meta}>
              Exit: {item.exit_code ?? "-"} | Duration: {item.duration_ms != null ? `${item.duration_ms} ms` : "-"}
            </div>

            <pre style={pre}>{shortText(item.stdout_preview || item.output, 600)}</pre>
            {(item.stderr_preview || item.error_message) && (
              <pre style={errorPre}>{shortText(item.stderr_preview || item.error_message, 600)}</pre>
            )}
          </div>
        ))
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: "12px",
  borderRadius: "8px",
  background: "#fff",
};

const block: React.CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
  marginBottom: "12px",
  paddingBottom: "12px",
};

const pre: React.CSSProperties = {
  background: "#111827",
  color: "#d1fae5",
  padding: "10px",
  whiteSpace: "pre-wrap",
  overflowX: "auto",
};

const errorPre: React.CSSProperties = {
  ...pre,
  color: "#fecaca",
};

const meta: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  marginTop: "6px",
};

const empty = {
  color: "#6b7280",
};
