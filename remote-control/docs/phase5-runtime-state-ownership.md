# Phase 5 Runtime State Ownership

- Last command status is owned by `agent/health.go` through `recordCommandSummary`; diagnostics only reads snapshots.
- Last file status is owned by `agent/health.go` through `recordFileSummary`; diagnostics only reads snapshots.
- Degraded counters and backend recovery state are owned by `agent/internal/recovery.Tracker`; health and diagnostics read its snapshot.
- Startup summaries are owned by the startup health gate in `agent/internal/health`; `agent/health.go` stores the latest summary for reporting.
- Server device health wording is derived from `server/src/health.js` plus latest `device_diagnostics`; it should not become a second source of agent runtime truth.
