package diagnostics

func Collect(input RuntimeInput) Snapshot {
	now := input.Now
	if now.IsZero() {
		now = timeNow()
	}

	uptimeSeconds := int64(0)
	if !input.StartupAt.IsZero() {
		uptimeSeconds = int64(now.Sub(input.StartupAt).Seconds())
		if uptimeSeconds < 0 {
			uptimeSeconds = 0
		}
	}

	startupOK := true
	if input.StartupChecks != nil {
		startupOK = input.StartupChecks.Passed
	}

	lastCommandStatus := ""
	if input.LastCommand != nil {
		lastCommandStatus = input.LastCommand.Status
	}

	lastFileStatus := ""
	if input.LastFile != nil {
		lastFileStatus = input.LastFile.Status
	}

	degraded := input.Recovery.Degraded || input.Watchdog.OperatorAttentionNeeded
	degradedReason := input.Recovery.DegradedReason
	if degradedReason == "" && input.Watchdog.OperatorAttentionNeeded {
		degradedReason = "operator attention needed"
		if len(input.Watchdog.Reasons) > 0 {
			degradedReason += ": " + input.Watchdog.Reasons[0]
		}
	}

	return Snapshot{
		DeviceID:                     input.DeviceID,
		Hostname:                     input.Hostname,
		Username:                     input.Username,
		RunMode:                      input.RunMode,
		Version:                      input.Version,
		ExecutablePath:               input.ExecutablePath,
		ConfigPath:                   input.ConfigPath,
		LogPath:                      input.LogPath,
		BackendURL:                   input.BackendURL,
		ServiceName:                  input.ServiceName,
		StartupOK:                    startupOK,
		StartupChecks:                input.StartupChecks,
		Recovery:                     input.Recovery,
		Watchdog:                     input.Watchdog,
		Degraded:                     degraded,
		DegradedReason:               degradedReason,
		OperatorAttentionNeeded:      input.Watchdog.OperatorAttentionNeeded,
		EscalationRequested:          input.Watchdog.EscalationRequested,
		LastSuccessfulBackendContact: input.Recovery.LastSuccessfulBackendContact,
		HeartbeatFailureCount:        input.Recovery.ConsecutiveBackendFailures,
		LastCommandStatus:            lastCommandStatus,
		LastFileStatus:               lastFileStatus,
		Upgrade:                      input.Upgrade,
		UptimeSeconds:                uptimeSeconds,
	}
}
