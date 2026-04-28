"use client";

import { useMemo, useState } from "react";

export type ConfirmationMode = "basic" | "warning" | "typed";

export type ConfirmationPayload = {
  intent: string;
  typedValue?: string;
};

export type ConfirmationRequest = {
  mode: ConfirmationMode;
  intent: string;
  typedValue?: string;
  title: string;
  consequence: string;
  checklist?: string[];
  runbookLink?: {
    href: string;
    label: string;
  };
  confirmLabel?: string;
};

type Props = {
  request: ConfirmationRequest | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (confirmation: ConfirmationPayload) => void;
};

export default function ConfirmationModal({ request, busy = false, onCancel, onConfirm }: Props) {
  const [typedValue, setTypedValue] = useState("");

  const canConfirm = useMemo(() => {
    if (!request) return false;
    if (busy) return false;
    if (request.mode !== "typed") return true;
    return typedValue.trim() === request.typedValue;
  }, [busy, request, typedValue]);

  if (!request) return null;

  const isWarning = request.mode === "warning" || request.mode === "typed";

  return (
    <div style={overlay} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        style={modal}
      >
        <h2 id="confirmation-title" style={title}>{request.title}</h2>
        <p style={bodyText}>{request.consequence}</p>

        {request.checklist && request.checklist.length > 0 && (
          <div style={checklistWrap}>
            <div style={checklistTitle}>Before continuing, confirm:</div>
            <ul style={checklist}>
              {request.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {request.mode === "typed" && (
          <label style={fieldLabel}>
            Type {request.typedValue} to continue
            <input
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              style={input}
              autoFocus
            />
          </label>
        )}

        {request.runbookLink && (
          <a href={request.runbookLink.href} target="_blank" rel="noreferrer" style={runbookLink}>
            Runbook: {request.runbookLink.label}
          </a>
        )}

        <div style={actions}>
          <button type="button" onClick={onCancel} disabled={busy} style={secondaryButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ intent: request.intent, typedValue })}
            disabled={!canConfirm}
            style={{
              ...primaryButton,
              background: isWarning ? "#b45309" : "#2563eb",
              borderColor: isWarning ? "#b45309" : "#2563eb",
              opacity: canConfirm ? 1 : 0.55,
              cursor: canConfirm ? "pointer" : "not-allowed",
            }}
          >
            {busy ? "Working..." : request.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "grid",
  placeItems: "center",
  padding: "20px",
  background: "rgba(17, 24, 39, 0.55)",
};

const modal: React.CSSProperties = {
  width: "min(520px, 100%)",
  borderRadius: "8px",
  border: "1px solid #d1d5db",
  background: "#fff",
  padding: "18px",
  boxShadow: "0 20px 45px rgba(17, 24, 39, 0.24)",
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: "20px",
  color: "#111827",
};

const bodyText: React.CSSProperties = {
  margin: "10px 0 0",
  color: "#374151",
  lineHeight: 1.45,
};

const checklistWrap: React.CSSProperties = {
  marginTop: "14px",
  padding: "12px",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  background: "#f9fafb",
};

const checklistTitle: React.CSSProperties = {
  fontWeight: 700,
  color: "#111827",
  marginBottom: "6px",
};

const checklist: React.CSSProperties = {
  margin: 0,
  paddingLeft: "20px",
  color: "#374151",
};

const fieldLabel: React.CSSProperties = {
  display: "grid",
  gap: "6px",
  marginTop: "14px",
  fontWeight: 700,
  color: "#111827",
};

const input: React.CSSProperties = {
  padding: "9px 10px",
  border: "1px solid #9ca3af",
  borderRadius: "6px",
  font: "inherit",
};

const runbookLink: React.CSSProperties = {
  display: "inline-block",
  marginTop: "12px",
  color: "#2563eb",
  fontSize: "14px",
  fontWeight: 700,
};

const actions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "8px",
  marginTop: "18px",
  flexWrap: "wrap",
};

const secondaryButton: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #9ca3af",
  borderRadius: "6px",
  background: "#fff",
  color: "#111827",
  cursor: "pointer",
};

const primaryButton: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #2563eb",
  borderRadius: "6px",
  color: "#fff",
};
