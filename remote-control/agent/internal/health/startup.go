package health

import (
	"context"

	"remote-control-agent/internal/logging"
)

func RunStartupChecks(ctx context.Context, cfg ConfigView, logger *logging.Logger) Summary {
	checks := []func() CheckResult{
		func() CheckResult { return CheckConfigFileExists(cfg) },
		func() CheckResult { return CheckConfigParses(cfg) },
		func() CheckResult { return CheckRequiredFields(cfg) },
		func() CheckResult { return CheckBackendURL(cfg) },
		func() CheckResult { return CheckDeviceID(cfg) },
		func() CheckResult { return CheckWritableDirs(cfg) },
		func() CheckResult { return CheckBackendConnectivity(ctx, cfg) },
		func() CheckResult { return CheckServiceContext(cfg) },
	}

	summary := Summary{Passed: true}
	for _, check := range checks {
		result := check()
		summary.Results = append(summary.Results, result)

		metadata := map[string]any{"check": result.Name, "severity": result.Severity}
		if result.OK {
			if logger != nil {
				logger.Info("startup-check", result.Message, metadata)
			}
			continue
		}

		summary.Passed = false
		if result.Severity == SeverityCritical {
			summary.Failed = append(summary.Failed, result)
			if logger != nil {
				logger.Error("startup-check", result.Message, result.Err, metadata)
			}
		} else {
			summary.Warnings = append(summary.Warnings, result)
			if logger != nil {
				logger.Warn("startup-check", result.Message, result.Err, metadata)
			}
		}
	}

	if len(summary.Failed) == 0 {
		summary.Passed = true
	}
	return summary
}
