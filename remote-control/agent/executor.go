package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

type CommandExecutionResult struct {
	Stdout       string
	Stderr       string
	Output       string
	ExitCode     int
	ErrorMessage string
	DurationMs   int64
	Err          error
}

func buildCommand(cmdStr string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("cmd", "/C", cmdStr)
	}

	return exec.Command("sh", "-c", cmdStr)
}

func ExecuteCommand(cmdStr string) (string, error) {
	cmd := buildCommand(cmdStr)

	var out bytes.Buffer
	var stderr bytes.Buffer

	cmd.Stdout = &out
	cmd.Stderr = &stderr

	err := cmd.Run()

	if err != nil {
		combined := out.String() + stderr.String()
		if combined == "" {
			combined = err.Error()
		}
		return combined, fmt.Errorf("execution error: %w", err)
	}

	return out.String() + stderr.String(), nil
}

func ExecuteCommandDetailed(cmdStr string) CommandExecutionResult {
	started := time.Now()
	cmd := buildCommand(cmdStr)

	var out bytes.Buffer
	var stderr bytes.Buffer

	cmd.Stdout = &out
	cmd.Stderr = &stderr

	err := cmd.Run()
	stdoutText := out.String()
	stderrText := stderr.String()
	output := stdoutText + stderrText
	errorMessage := ""
	exitCode := commandExitCode(err)

	if err != nil {
		errorMessage = err.Error()
		if output == "" {
			output = errorMessage
			stderrText = errorMessage
		}
	}

	return CommandExecutionResult{
		Stdout:       stdoutText,
		Stderr:       stderrText,
		Output:       output,
		ExitCode:     exitCode,
		ErrorMessage: errorMessage,
		DurationMs:   time.Since(started).Milliseconds(),
		Err:          err,
	}
}

func ExecuteCommandStreaming(cmdStr string, onChunk func(string)) (string, error) {
	cmd := buildCommand(cmdStr)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("stdout pipe error: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("stderr pipe error: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start error: %w", err)
	}

	var combined bytes.Buffer

	readPipe := func(scanner *bufio.Scanner) {
		for scanner.Scan() {
			line := scanner.Text() + "\n"
			combined.WriteString(line)
			onChunk(line)
		}
	}

	stdoutScanner := bufio.NewScanner(stdout)
	stderrScanner := bufio.NewScanner(stderr)

	done := make(chan struct{}, 2)

	go func() {
		readPipe(stdoutScanner)
		done <- struct{}{}
	}()

	go func() {
		readPipe(stderrScanner)
		done <- struct{}{}
	}()

	<-done
	<-done

	if err := cmd.Wait(); err != nil {
		if combined.Len() == 0 {
			combined.WriteString(err.Error())
		}
		return combined.String(), fmt.Errorf("execution error: %w", err)
	}

	return combined.String(), nil
}

func commandExitCode(err error) int {
	if err == nil {
		return 0
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}

	return -1
}
