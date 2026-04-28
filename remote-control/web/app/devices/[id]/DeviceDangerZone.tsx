"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiBaseUrl } from "../../lib/api";
import ConfirmationModal, { ConfirmationPayload, ConfirmationRequest } from "./ConfirmationModal";

const deleteConfirmation: ConfirmationRequest = {
  mode: "typed",
  intent: "device-delete",
  typedValue: "DELETE",
  title: "Delete device record?",
  consequence: "This removes the device record from the admin database. A running agent may register again on a future heartbeat.",
  checklist: [
    "This is the intended device.",
    "Recent history for this device is no longer needed in the admin view.",
  ],
  runbookLink: {
    href: "/docs/runbook/troubleshooting.md",
    label: "Troubleshooting",
  },
  confirmLabel: "Delete device",
};

export default function DeviceDangerZone({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  async function deleteDevice(confirmation: ConfirmationPayload) {
    setDeleting(true);
    setMessage("Deleting device...");

    try {
      const res = await fetch(`${apiBaseUrl()}/api/devices/${deviceId}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Delete failed");
        return;
      }

      router.push("/admin/devices");
      router.refresh();
    } catch {
      setMessage("Request failed");
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={deleting}
        style={deleteButton}
      >
        {deleting ? "Deleting..." : "Delete device"}
      </button>
      {message && <div style={{ color: "#7f1d1d", fontSize: "14px" }}>{message}</div>}
      <ConfirmationModal
        request={confirming ? deleteConfirmation : null}
        busy={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={deleteDevice}
      />
    </div>
  );
}

const deleteButton: React.CSSProperties = {
  width: "fit-content",
  padding: "8px 12px",
  border: "1px solid #b91c1c",
  borderRadius: "6px",
  background: "#b91c1c",
  color: "#fff",
  cursor: "pointer",
};
