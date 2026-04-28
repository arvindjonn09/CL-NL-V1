"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiBaseUrl } from "../../lib/api";
import ConfirmationModal, { ConfirmationPayload, ConfirmationRequest } from "./ConfirmationModal";

const options = ["unknown", "dev", "test", "prod", "personal"];

export default function EnvironmentEditor({
  deviceId,
  initialEnvironment,
}: {
  deviceId: string;
  initialEnvironment: string;
}) {
  const router = useRouter();
  const [environmentLabel, setEnvironmentLabel] = useState(initialEnvironment);
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const confirmation: ConfirmationRequest = {
    mode: "warning",
    intent: "environment-change",
    title: "Change device environment?",
    consequence: `The device will be labeled as ${environmentLabel}. This affects admin grouping and operator context.`,
    checklist: [
      "The selected environment matches the device owner or deployment.",
      "You are not masking a production device as a lower-risk environment.",
    ],
    runbookLink: {
      href: "/docs/runbook/troubleshooting.md",
      label: "Troubleshooting",
    },
    confirmLabel: "Save environment",
  };

  async function save(confirm: ConfirmationPayload) {
    setSaving(true);
    setStatus("Saving...");
    try {
      const res = await fetch(`${apiBaseUrl()}/api/devices/${deviceId}/environment`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentLabel, confirmation: confirm }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error || "Save failed");
        return;
      }

      setStatus("Environment updated");
      setConfirming(false);
      router.refresh();
    } catch {
      setStatus("Request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
      <label htmlFor="environment" style={{ fontWeight: 700 }}>Environment</label>
      <select
        id="environment"
        value={environmentLabel}
        onChange={(event) => setEnvironmentLabel(event.target.value)}
        style={select}
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <button type="button" onClick={() => setConfirming(true)} disabled={saving} style={button}>
        {saving ? "Saving..." : "Save"}
      </button>
      {status && <span style={{ color: "#374151", fontSize: "14px" }}>{status}</span>}
      <ConfirmationModal
        request={confirming ? confirmation : null}
        busy={saving}
        onCancel={() => setConfirming(false)}
        onConfirm={save}
      />
    </div>
  );
}

const select: React.CSSProperties = {
  padding: "7px 10px",
  border: "1px solid #9ca3af",
  borderRadius: "6px",
};

const button: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #2563eb",
  borderRadius: "6px",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
