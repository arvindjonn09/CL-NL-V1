package recovery

import (
	"context"
	"fmt"

	"remote-control-agent/internal/logging"
)

type HTTPStatusError struct {
	StatusCode int
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("request failed: status %d", e.StatusCode)
}

func DoBackend(ctx context.Context, tracker *Tracker, logger *logging.Logger, policy Policy, action string, operation Operation) error {
	err := Do(ctx, policy, operation)
	if err != nil {
		policy = policy.withDefaults()
		if tracker != nil && policy.Retryable(err) {
			event := tracker.RecordBackendFailure(err)
			logTransition(logger, event)
		}
		return err
	}

	if tracker != nil {
		event := tracker.RecordBackendSuccess()
		logTransition(logger, event)
	}
	return nil
}

func logTransition(logger *logging.Logger, event TransitionEvent) {
	if logger == nil || event.From == event.To {
		return
	}

	metadata := map[string]any{
		"from": event.From,
		"to":   event.To,
	}
	if event.Reason != "" {
		metadata["reason"] = event.Reason
	}

	if event.To == StateNormal {
		logger.Info("recovered", "backend connectivity is stable again", metadata)
		return
	}
	if event.To == StateDegraded {
		logger.Warn("degraded", "backend connectivity degraded", nil, metadata)
		return
	}
	logger.Info("recovering", "backend connectivity recovered; confirming stability", metadata)
}
