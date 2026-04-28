package recovery

import (
	"context"
	"errors"
	"math/rand"
	"net"
	"time"
)

type Operation func(context.Context) error
type RetryableFunc func(error) bool
type SleepFunc func(context.Context, time.Duration) error

type Policy struct {
	MaxAttempts   int
	InitialDelay  time.Duration
	MaxDelay      time.Duration
	JitterPercent float64
	Retryable     RetryableFunc
	Sleep         SleepFunc
}

func Do(ctx context.Context, policy Policy, operation Operation) error {
	policy = policy.withDefaults()

	var lastErr error
	for attempt := 1; attempt <= policy.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}

		err := operation(ctx)
		if err == nil {
			return nil
		}
		lastErr = err

		if attempt == policy.MaxAttempts || !policy.Retryable(err) {
			return err
		}

		if err := policy.Sleep(ctx, BackoffForAttempt(policy, attempt)); err != nil {
			return err
		}
	}

	return lastErr
}

func BackoffForAttempt(policy Policy, attempt int) time.Duration {
	policy = policy.withDefaults()
	delay := policy.InitialDelay
	for i := 1; i < attempt; i++ {
		delay *= 2
		if delay >= policy.MaxDelay {
			delay = policy.MaxDelay
			break
		}
	}

	if policy.JitterPercent <= 0 {
		return delay
	}
	spread := int64(float64(delay) * policy.JitterPercent)
	if spread <= 0 {
		return delay
	}
	offset := rand.Int63n(spread*2+1) - spread
	return delay + time.Duration(offset)
}

func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	var statusErr *HTTPStatusError
	if errors.As(err, &statusErr) {
		return statusErr.StatusCode == 408 || statusErr.StatusCode == 429 || statusErr.StatusCode >= 500
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}

	return false
}

func sleepContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (p Policy) withDefaults() Policy {
	if p.MaxAttempts <= 0 {
		p.MaxAttempts = 3
	}
	if p.InitialDelay <= 0 {
		p.InitialDelay = 500 * time.Millisecond
	}
	if p.MaxDelay <= 0 {
		p.MaxDelay = 10 * time.Second
	}
	if p.InitialDelay > p.MaxDelay {
		p.InitialDelay = p.MaxDelay
	}
	if p.Retryable == nil {
		p.Retryable = IsRetryable
	}
	if p.Sleep == nil {
		p.Sleep = sleepContext
	}
	return p
}
