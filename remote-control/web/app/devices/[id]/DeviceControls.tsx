"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiBaseUrl } from "../../lib/api";
import ConfirmationModal, { ConfirmationPayload, ConfirmationRequest } from "./ConfirmationModal";

const actions = [
  {
    type: "force-heartbeat",
    label: "Request heartbeat",
    confirmation: {
      mode: "basic",
      intent: "force-heartbeat",
      title: "Request heartbeat?",
      consequence: "The agent will send a heartbeat and refresh its current health snapshot.",
      confirmLabel: "Request heartbeat",
    },
  },
  {
    type: "refresh-metadata",
    label: "Refresh metadata",
    confirmation: {
      mode: "basic",
      intent: "refresh-metadata",
      title: "Refresh metadata?",
      consequence: "The agent will send current runtime metadata on its next action execution.",
      confirmLabel: "Refresh metadata",
    },
  },
  {
    type: "runtime-log-snapshot",
    label: "Fetch runtime/log snapshot",
    confirmation: {
      mode: "basic",
      intent: "runtime-log-snapshot",
      title: "Fetch runtime/log snapshot?",
      consequence: "The agent will return recent runtime details and a recent log excerpt.",
      confirmLabel: "Fetch snapshot",
    },
  },
  {
    type: "restart-service",
    label: "Restart service",
    confirmation: {
      mode: "warning",
      intent: "restart-service",
      title: "Restart SetuLinkAgent?",
      consequence: "The Windows service will restart. The device may disconnect briefly while the agent comes back online.",
      checklist: [
        "No command or file transfer is expected to be in progress.",
        "A brief offline or stale status is acceptable.",
      ],
      runbookLink: {
        href: "/docs/runbook/recovery.md",
        label: "Recovery",
      },
      confirmLabel: "Restart service",
    },
  },
  {
    type: "check-upgrade",
    label: "Check upgrade",
    confirmation: {
      mode: "warning",
      intent: "check-upgrade",
      title: "Check and stage upgrade?",
      consequence: "The agent will fetch the approved manifest, download the binary, verify it, and stage it for later apply.",
      checklist: [
        "The approved manifest points to the intended version.",
        "The device has network access to the download URL.",
      ],
      runbookLink: {
        href: "/docs/runbook/upgrade.md",
        label: "Upgrade",
      },
      confirmLabel: "Check upgrade",
    },
  },
  {
    type: "apply-staged-upgrade",
    label: "Apply staged upgrade",
    confirmation: {
      mode: "typed",
      intent: "apply-staged-upgrade",
      typedValue: "APPLY",
      title: "Apply staged upgrade?",
      consequence: "The updater helper will replace the agent binary and restart the service. Rollback is attempted if startup checks fail.",
      checklist: [
        "The staged upgrade was verified successfully.",
        "A service restart and short disconnect are acceptable.",
      ],
      runbookLink: {
        href: "/docs/runbook/upgrade.md",
        label: "Upgrade",
      },
      confirmLabel: "Apply upgrade",
    },
  },
];

type RecentAction = {
  action_type: string;
  status: string;
  requested_at?: string | null;
  completed_at?: string | null;
  result_summary?: string | null;
  error_summary?: string | null;
};

function isInProgress(action: RecentAction) {
  return action.status === "pending" || action.status === "running";
}

function latestActionResult(actions: RecentAction[]) {
  return actions.find((action) => action.completed_at || action.requested_at);
}

export default function DeviceControls({
  deviceId,
  recentActions = [],
  hasStagedUpgrade = false,
}: {
  deviceId: string;
  recentActions?: RecentAction[];
  hasStagedUpgrade?: boolean;
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<typeof actions[number] | null>(null);
  const lastAction = latestActionResult(recentActions);

  function disabledReason(actionType: string) {
    if (busyAction !== null) return "Another action is being queued.";
    if (recentActions.some((action) => action.action_type === actionType && isInProgress(action))) {
      return "This action is already in progress.";
    }
    if (actionType === "restart-service" && recentActions.some((action) => action.action_type === "restart-service" && isInProgress(action))) {
      return "Restart is already in progress.";
    }
    if (actionType === "apply-staged-upgrade" && !hasStagedUpgrade) {
      return "No staged upgrade is currently known.";
    }
    return "";
  }

  async function runAction(actionType: string, confirmation: ConfirmationPayload) {
    setBusyAction(actionType);
    setMessage("Queuing action...");

    try {
      const res = await fetch(`${apiBaseUrl()}/api/devices/${deviceId}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType, confirmation }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Action failed");
        return;
      }

      setMessage(`Queued ${actionType}: ${data.action.id}`);
      setPendingAction(null);
      router.refresh();
    } catch {
      setMessage("Request failed");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {actions.map((action) => {
          const reason = disabledReason(action.type);
          return (
            <button
              key={action.type}
              type="button"
              onClick={() => setPendingAction(action)}
              disabled={Boolean(reason)}
              title={reason || action.label}
              style={reason ? disabledButton : button}
            >
              {busyAction === action.type ? "Queuing..." : action.label}
            </button>
          );
        })}
      </div>
      {message && <div style={{ color: "#374151", fontSize: "14px" }}>{message}</div>}
      {lastAction && (
        <div style={{ color: "#374151", fontSize: "14px" }}>
          Last action: <strong>{lastAction.action_type}</strong> {lastAction.status}
          {(lastAction.error_summary || lastAction.result_summary) ? ` - ${lastAction.error_summary || lastAction.result_summary}` : ""}
        </div>
      )}
      <ConfirmationModal
        request={pendingAction?.confirmation as ConfirmationRequest | null}
        busy={busyAction !== null}
        onCancel={() => setPendingAction(null)}
        onConfirm={(confirmation) => {
          if (pendingAction) runAction(pendingAction.type, confirmation);
        }}
      />
    </div>
  );
}

const button: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #9ca3af",
  borderRadius: "6px",
  background: "#fff",
  cursor: "pointer",
};

const disabledButton: React.CSSProperties = {
  ...button,
  color: "#6b7280",
  background: "#f3f4f6",
  cursor: "not-allowed",
};
