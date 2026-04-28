package recovery

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"
)

func TestDoRetriesWithCappedBackoff(t *testing.T) {
	var attempts int
	var delays []time.Duration
	policy := Policy{
		MaxAttempts:   3,
		InitialDelay:  10 * time.Millisecond,
		MaxDelay:      15 * time.Millisecond,
		JitterPercent: 0,
		Retryable:     func(error) bool { return true },
		Sleep: func(_ context.Context, delay time.Duration) error {
			delays = append(delays, delay)
			return nil
		},
	}

	err := Do(context.Background(), policy, func(context.Context) error {
		attempts++
		if attempts < 3 {
			return &net.DNSError{IsTemporary: true}
		}
		return nil
	})

	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
	if len(delays) != 2 || delays[0] != 10*time.Millisecond || delays[1] != 15*time.Millisecond {
		t.Fatalf("unexpected delays: %v", delays)
	}
}

func TestDoDoesNotRetryNonRetryableError(t *testing.T) {
	var attempts int
	nonRetryable := errors.New("bad request")
	err := Do(context.Background(), Policy{
		MaxAttempts: 3,
		Retryable:   func(error) bool { return false },
		Sleep: func(context.Context, time.Duration) error {
			t.Fatalf("sleep should not be called")
			return nil
		},
	}, func(context.Context) error {
		attempts++
		return nonRetryable
	})

	if !errors.Is(err, nonRetryable) {
		t.Fatalf("expected non-retryable error, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt, got %d", attempts)
	}
}

func TestIsRetryableStatusCodes(t *testing.T) {
	if !IsRetryable(&HTTPStatusError{StatusCode: 503}) {
		t.Fatalf("expected 503 to be retryable")
	}
	if !IsRetryable(&HTTPStatusError{StatusCode: 429}) {
		t.Fatalf("expected 429 to be retryable")
	}
	if IsRetryable(&HTTPStatusError{StatusCode: 404}) {
		t.Fatalf("expected 404 to be non-retryable")
	}
}
