package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	agentrecovery "remote-control-agent/internal/recovery"
)

type FileJob struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	URL      string `json:"url"`
}

type FileTransferResult struct {
	DestinationPath  string
	BytesTransferred int64
}

func pollFiles(cfg Config) {
	for {
		recordWatchdogLoop("file-worker")
		logger("files").Debug("poll", "file polling started", nil)
		time.Sleep(5 * time.Second)

		query := url.Values{}
		query.Set("id", cfg.DeviceID)
		var data struct {
			File *FileJob `json:"file"`
		}

		if err := doAgentRequest(&cfg, "GET", agentURL(&cfg, "/api/agent/next-file", query), nil, &data); err != nil {
			recordWatchdogFileFailure(err)
			logger("files").Warn("poll", "file poll failed", err, nil)
			continue
		}

		if data.File == nil {
			recordWatchdogFileSuccess()
			logger("files").Debug("poll", "no file jobs available", nil)
			continue
		}

		logger("files").Info("download-start", "file download started", logMetadata("fileId", data.File.ID, "filename", data.File.Filename))

		result, err := downloadAndSave(cfg, data.File)
		if err != nil {
			recordWatchdogFileFailure(err)
			recordFileSummary(OperationSummary{
				ID:           data.File.ID,
				Filename:     data.File.Filename,
				Status:       "failed",
				ErrorMessage: err.Error(),
			})
			recordAgentError("file-transfer", err)
			logger("files").Warn("download", "file download/save failed", err, logMetadata("fileId", data.File.ID, "filename", data.File.Filename))
			if notifyErr := markFileFailed(cfg, data.File.ID, err.Error(), ""); notifyErr != nil {
				recordWatchdogFileFailure(notifyErr)
				recordAgentError("file-failed", notifyErr)
				logger("files").Warn("failed-post", "file failed status post failed", notifyErr, logMetadata("fileId", data.File.ID))
			}
			continue
		}

		recordFileSummary(OperationSummary{
			ID:               data.File.ID,
			Filename:         data.File.Filename,
			Status:           "completed",
			BytesTransferred: result.BytesTransferred,
			DestinationPath:  result.DestinationPath,
		})

		if err := markFileComplete(cfg, data.File.ID, result); err != nil {
			recordWatchdogFileFailure(err)
			recordAgentError("file-complete", err)
			logger("files").Warn("complete-post", "file complete status post failed", err, logMetadata("fileId", data.File.ID))
			continue
		}

		recordWatchdogFileSuccess()
		logger("files").Info("complete", "file transfer completed", logMetadata("fileId", data.File.ID, "filename", data.File.Filename, "bytesTransferred", result.BytesTransferred))
	}
}

func downloadAndSave(cfg Config, file *FileJob) (FileTransferResult, error) {
	result, err := agentrecovery.DownloadFile(
		context.Background(),
		agentrecovery.FileTransferPolicy(),
		currentAgentHTTPClient(),
		file.URL,
		cfg.FilesPath,
		cfg.TempPath,
		file.Filename,
	)
	if err != nil {
		return FileTransferResult{}, err
	}

	logger("files").Info("saved", "file saved", logMetadata("path", result.DestinationPath, "bytesTransferred", result.BytesTransferred))
	return FileTransferResult{
		DestinationPath:  result.DestinationPath,
		BytesTransferred: result.BytesTransferred,
	}, nil
}

func markFileComplete(cfg Config, fileID string, result FileTransferResult) error {
	body, err := json.Marshal(map[string]interface{}{
		"id":               fileID,
		"deviceId":         cfg.DeviceID,
		"bytesTransferred": result.BytesTransferred,
		"destinationPath":  result.DestinationPath,
	})
	if err != nil {
		return fmt.Errorf("marshal complete payload: %w", err)
	}

	if err := doAgentRequest(&cfg, "POST", agentURL(&cfg, "/api/agent/file-complete", nil), json.RawMessage(body), nil); err != nil {
		return fmt.Errorf("file complete POST error: %w", err)
	}

	return nil
}

func markFileFailed(cfg Config, fileID string, errorMessage string, destinationPath string) error {
	body, err := json.Marshal(map[string]string{
		"id":              fileID,
		"deviceId":        cfg.DeviceID,
		"errorMessage":    errorMessage,
		"destinationPath": destinationPath,
	})
	if err != nil {
		return fmt.Errorf("marshal failed payload: %w", err)
	}

	if err := doAgentRequest(&cfg, "POST", agentURL(&cfg, "/api/agent/file-failed", nil), json.RawMessage(body), nil); err != nil {
		return fmt.Errorf("file failed POST error: %w", err)
	}

	return nil
}
