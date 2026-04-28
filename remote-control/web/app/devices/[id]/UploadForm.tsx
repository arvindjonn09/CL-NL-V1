"use client";

import React, { useRef, useState } from "react";
import { apiBaseUrl } from "../../lib/api";
import ConfirmationModal, { ConfirmationPayload, ConfirmationRequest } from "./ConfirmationModal";

function UploadForm({ deviceId }: { deviceId: string }) {
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [status, setStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function pausePolling() {
    window.localStorage.setItem("setulinkPausePolling", "1");
  }

  function resumePolling() {
    window.localStorage.removeItem("setulinkPausePolling");
  }

  function handleFileClick() {
    pausePolling();
  }

  function handleFileFocus() {
    pausePolling();
  }

  function handleFileChange() {
    const input = fileInputRef.current;
    if (input?.files && input.files.length > 0) {
      setSelectedFileName(input.files[0].name);
      pausePolling();
      return;
    }
    setSelectedFileName("");
  }

  function clearSelection() {
    const input = fileInputRef.current;
    if (input) {
      input.value = "";
    }
    setSelectedFileName("");
    resumePolling();
  }

  function selectedFile() {
    const input = fileInputRef.current;
    return input?.files && input.files.length > 0 ? input.files[0] : null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedFile()) {
      alert("Select a file");
      return;
    }

    setStatus("");
    setConfirming(true);
  }

  async function uploadFile(confirmation: ConfirmationPayload) {
    const input = fileInputRef.current;
    const file = selectedFile();

    if (!input || !file) {
      alert("Select a file");
      setConfirming(false);
      return;
    }

    setUploading(true);
    setStatus("Uploading...");

    const data = new FormData();
    data.append("file", file);
    data.append("deviceId", deviceId);
    data.append("confirmationIntent", confirmation.intent);

    try {
      const res = await fetch(`${apiBaseUrl()}/api/files/upload`, {
        method: "POST",
        credentials: "include",
        body: data,
      });

      if (!res.ok) {
        setStatus("Upload failed");
        setUploading(false);
        return;
      }

      setStatus("Upload queued");
      input.value = "";
      setSelectedFileName("");
      setConfirming(false);
      resumePolling();
    } catch (err) {
      console.error(err);
      setStatus("Network error");
    }

    setUploading(false);
  }

  const confirmation: ConfirmationRequest = {
    mode: "warning",
    intent: "file-upload",
    title: "Upload file to device?",
    consequence: `This queues ${selectedFileName || "the selected file"} for download by the agent on this device.`,
    checklist: [
      "The file is intended for this device.",
      "The device has enough disk space and is expected to receive files.",
    ],
    runbookLink: {
      href: "/docs/runbook/troubleshooting.md",
      label: "Troubleshooting",
    },
    confirmLabel: "Upload file",
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Upload File</h2>

      <form onSubmit={handleSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          disabled={uploading || confirming}
          onClick={handleFileClick}
          onFocus={handleFileFocus}
          onChange={handleFileChange}
        />

        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <button type="submit" disabled={uploading || confirming}>
            {uploading ? "Uploading..." : confirming ? "Confirming..." : "Upload"}
          </button>

          <button
            type="button"
            onClick={clearSelection}
            disabled={uploading || confirming}
          >
            Clear selection
          </button>
        </div>
      </form>
      {status && <p style={{ marginTop: "10px", color: "#374151" }}>{status}</p>}
      <ConfirmationModal
        request={confirming ? confirmation : null}
        busy={uploading}
        onCancel={() => setConfirming(false)}
        onConfirm={uploadFile}
      />
    </div>
  );
}

export default React.memo(UploadForm);
