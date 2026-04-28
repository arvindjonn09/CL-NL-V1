package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	agentrecovery "remote-control-agent/internal/recovery"
)

func agentURL(cfg *Config, path string, query url.Values) string {
	base := strings.TrimRight(cfg.ServerURL, "/") + path
	if len(query) == 0 {
		return base
	}
	return base + "?" + query.Encode()
}

func newAgentRequest(cfg *Config, method string, url string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}

	req.Header.Set("X-SetuLink-Agent-Token", cfg.AgentToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return req, nil
}

func doAgentRequest(cfg *Config, method string, url string, payload interface{}, target interface{}) error {
	var data []byte
	var err error
	if payload != nil {
		data, err = json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("marshal request payload: %w", err)
		}
	}

	policy := backendPolicyFor(method, url)
	err = agentrecovery.DoBackend(context.Background(), recoveryTracker, logger("recovery"), policy, method+" "+url, func(ctx context.Context) error {
		var body io.Reader
		if data != nil {
			body = bytes.NewReader(data)
		}

		req, err := newAgentRequest(cfg, method, url, body)
		if err != nil {
			return fmt.Errorf("build request: %w", err)
		}
		req = req.WithContext(ctx)

		resp, err := currentAgentHTTPClient().Do(req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return &agentrecovery.HTTPStatusError{StatusCode: resp.StatusCode}
		}

		if target != nil {
			if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
				return fmt.Errorf("decode response: %w", err)
			}
		}

		return nil
	})

	if err != nil && agentrecovery.IsRetryable(err) {
		rebuildAgentHTTPClient(15 * time.Second)
		logger("recovery").Info("repair-http-client", "HTTP client rebuilt after retryable backend failure", nil)
	}
	if err != nil {
		recordWatchdogBackendFailure(err)
	} else {
		recordWatchdogBackendSuccess()
	}

	return err
}

func nextBackoff(current time.Duration) time.Duration {
	if current <= 0 {
		return 2 * time.Second
	}
	next := current * 2
	if next > 60*time.Second {
		return 60 * time.Second
	}
	return next
}
