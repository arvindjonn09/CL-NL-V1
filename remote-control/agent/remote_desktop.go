package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"github.com/pion/webrtc/v4/pkg/media/ivfreader"
	agentremotedesktop "remote-control-agent/internal/remotedesktop"
)

type RemoteDesktopPendingSession struct {
	ID             string `json:"id"`
	DeviceID       string `json:"device_id"`
	Status         string `json:"status"`
	SignalingState string `json:"signaling_state"`
	TransportState string `json:"transport_state"`
}

type RemoteDesktopPendingResponse struct {
	Sessions []RemoteDesktopPendingSession `json:"sessions"`
}

type RemoteDesktopSessionResponse struct {
	Session RemoteDesktopAgentSession `json:"session"`
}

type RemoteDesktopAgentSession struct {
	ID           string                     `json:"id"`
	DeviceID     string                     `json:"deviceId"`
	Status       string                     `json:"status"`
	BrowserOffer *webrtc.SessionDescription `json:"browserOffer"`
	BrowserIce   []webrtc.ICECandidateInit  `json:"browserIce"`
	Ice          RemoteDesktopIceConfig     `json:"ice"`
}

type RemoteDesktopIceConfig struct {
	IceServers []webrtc.ICEServer `json:"iceServers"`
	Summary    []map[string]any   `json:"summary,omitempty"`
}

type RemoteDesktopStatusRequest struct {
	DeviceID string `json:"deviceId"`
	Status   string `json:"status"`
	Reason   string `json:"reason,omitempty"`
}

type RemoteDesktopAnswerRequest struct {
	DeviceID string                    `json:"deviceId"`
	Answer   webrtc.SessionDescription `json:"answer"`
}

type RemoteDesktopIceRequest struct {
	DeviceID  string                  `json:"deviceId"`
	Candidate webrtc.ICECandidateInit `json:"candidate"`
}

type activeRemoteDesktopRuntime struct {
	cancel context.CancelFunc
	pipe   desktopPipeConn
}

var remoteDesktopRuntimes = struct {
	sync.Mutex
	active map[string]activeRemoteDesktopRuntime
}{
	active: make(map[string]activeRemoteDesktopRuntime),
}

const remoteDesktopMediaActiveTimeout = 60 * time.Second

func FetchPendingRemoteDesktopSessions(cfg *Config) ([]RemoteDesktopPendingSession, error) {
	query := url.Values{}
	query.Set("id", cfg.DeviceID)

	var data RemoteDesktopPendingResponse
	if err := doAgentRequest(cfg, "GET", agentURL(cfg, "/api/agent/remote-desktop/pending", query), nil, &data); err != nil {
		return nil, fmt.Errorf("fetch remote desktop pending sessions failed: %w", err)
	}

	return data.Sessions, nil
}

func FetchRemoteDesktopSession(cfg *Config, sessionID string) (RemoteDesktopAgentSession, error) {
	query := url.Values{}
	query.Set("deviceId", cfg.DeviceID)

	var data RemoteDesktopSessionResponse
	if err := doAgentRequest(cfg, "GET", agentURL(cfg, "/api/agent/remote-desktop/sessions/"+sessionID, query), nil, &data); err != nil {
		return RemoteDesktopAgentSession{}, fmt.Errorf("fetch remote desktop session failed: %w", err)
	}

	return data.Session, nil
}

func SendRemoteDesktopStatus(cfg *Config, sessionID, status, reason string) error {
	body := RemoteDesktopStatusRequest{
		DeviceID: cfg.DeviceID,
		Status:   status,
		Reason:   reason,
	}
	return doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/remote-desktop/sessions/"+sessionID+"/status", nil), body, nil)
}

func SendRemoteDesktopAnswer(cfg *Config, sessionID string, answer webrtc.SessionDescription) error {
	body := RemoteDesktopAnswerRequest{
		DeviceID: cfg.DeviceID,
		Answer:   answer,
	}
	return doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/remote-desktop/sessions/"+sessionID+"/answer", nil), body, nil)
}

func SendRemoteDesktopIce(cfg *Config, sessionID string, candidate webrtc.ICECandidateInit) error {
	body := RemoteDesktopIceRequest{
		DeviceID:  cfg.DeviceID,
		Candidate: candidate,
	}
	return doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/remote-desktop/sessions/"+sessionID+"/ice", nil), body, nil)
}

func ProcessRemoteDesktopPending(cfg *Config) {
	sessions, err := FetchPendingRemoteDesktopSessions(cfg)
	if err != nil {
		recordAgentError("remote-desktop-poll", err)
		logger("remote-desktop").Warn("poll", "remote desktop pending poll failed", err, nil)
		return
	}

	capability := agentremotedesktop.CurrentCapability()
	for _, session := range sessions {
		if capability.State != "ready" {
			reason := capability.Reason
			if reason == "" {
				reason = "remote desktop runtime is not ready"
			}
			if err := SendRemoteDesktopStatus(cfg, session.ID, "failed", reason); err != nil {
				recordAgentError("remote-desktop-status", err)
				logger("remote-desktop").Warn("status", "remote desktop status update failed", err, logMetadata("sessionId", session.ID))
			} else {
				logger("remote-desktop").Info("not-ready", "remote desktop session rejected because runtime is not ready", logMetadata("sessionId", session.ID))
			}
			continue
		}

		if isRemoteDesktopRuntimeActive(session.ID) {
			continue
		}

		detail, err := FetchRemoteDesktopSession(cfg, session.ID)
		if err != nil {
			recordAgentError("remote-desktop-session", err)
			logger("remote-desktop").Warn("session", "remote desktop session lookup failed", err, logMetadata("sessionId", session.ID))
			continue
		}
		if detail.BrowserOffer == nil {
			if err := SendRemoteDesktopStatus(cfg, session.ID, "waiting_for_agent", "waiting for browser offer"); err != nil {
				recordAgentError("remote-desktop-status", err)
			}
			continue
		}

		if err := SendRemoteDesktopStatus(cfg, session.ID, "signaling", "agent preparing WebRTC answer"); err != nil {
			recordAgentError("remote-desktop-status", err)
			logger("remote-desktop").Warn("status", "remote desktop status update failed", err, logMetadata("sessionId", session.ID))
			continue
		}

		startRemoteDesktopRuntime(cfg, detail)
	}
}

func isRemoteDesktopRuntimeActive(sessionID string) bool {
	remoteDesktopRuntimes.Lock()
	defer remoteDesktopRuntimes.Unlock()
	_, ok := remoteDesktopRuntimes.active[sessionID]
	return ok
}

func startRemoteDesktopRuntime(cfg *Config, session RemoteDesktopAgentSession) {
	ctx, cancel := context.WithCancel(context.Background())
	remoteDesktopRuntimes.Lock()
	if _, exists := remoteDesktopRuntimes.active[session.ID]; exists {
		remoteDesktopRuntimes.Unlock()
		cancel()
		return
	}
	remoteDesktopRuntimes.active[session.ID] = activeRemoteDesktopRuntime{cancel: cancel}
	remoteDesktopRuntimes.Unlock()

	go func() {
		defer func() {
			cancel()
			remoteDesktopRuntimes.Lock()
			delete(remoteDesktopRuntimes.active, session.ID)
			remoteDesktopRuntimes.Unlock()
		}()

		if err := runRemoteDesktopRuntime(ctx, cfg, session); err != nil {
			recordAgentError("remote-desktop-runtime", err)
			logger("remote-desktop").Warn("runtime", "remote desktop runtime failed", err, logMetadata("sessionId", session.ID))
			_ = SendRemoteDesktopStatus(cfg, session.ID, "failed", err.Error())
		}
	}()
}

func runRemoteDesktopRuntime(ctx context.Context, cfg *Config, session RemoteDesktopAgentSession) error {
	if session.BrowserOffer == nil {
		return fmt.Errorf("browser offer is required")
	}
	logger("remote-desktop").Info("runtime-start", "remote desktop runtime starting", logMetadata(
		"sessionId", session.ID,
		"iceServerCount", len(session.Ice.IceServers),
		"iceServerSummary", session.Ice.Summary,
		"initialBrowserIceCount", len(session.BrowserIce),
	))

	cmd, err := agentremotedesktop.StartCapture(ctx)
	if err != nil {
		return err
	}
	if ffmpeg, err := agentremotedesktop.ResolveFFmpeg(); err == nil {
		metadata := logMetadata(
			"sessionId", session.ID,
			"ffmpegPath", ffmpeg.Path,
			"ffmpegSource", ffmpeg.Source,
			"ffmpegCommand", agentremotedesktop.CaptureCommandLineFromArgs(cmd.Args()),
		)
		for key, value := range agentremotedesktop.CaptureLaunchMetadata(cmd) {
			metadata[key] = value
		}
		logger("remote-desktop").Info("capture-runtime", "remote desktop ffmpeg resolved", metadata)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open capture stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("open capture stderr: %w", err)
	}

	peer, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: session.Ice.IceServers})
	if err != nil {
		return fmt.Errorf("create peer connection: %w", err)
	}
	defer peer.Close()
	logger("remote-desktop").Info("peer-created", "remote desktop peer connection created", logMetadata("sessionId", session.ID))

	videoTrack, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "desktop", "setulink")
	if err != nil {
		return fmt.Errorf("create video track: %w", err)
	}
	if _, err := peer.AddTrack(videoTrack); err != nil {
		return fmt.Errorf("add video track: %w", err)
	}
	logger("remote-desktop").Info("track-created", "remote desktop local video track added", logMetadata("sessionId", session.ID, "mimeType", webrtc.MimeTypeVP8))

	peer.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			logger("remote-desktop").Info("ice", "remote desktop local ICE gathering complete", logMetadata("sessionId", session.ID))
			return
		}
		logger("remote-desktop").Info("ice", "remote desktop local ICE candidate generated", logMetadata(
			"sessionId", session.ID,
			"candidateType", candidate.Typ.String(),
		))
		if err := SendRemoteDesktopIce(cfg, session.ID, candidate.ToJSON()); err != nil {
			logger("remote-desktop").Warn("ice", "remote desktop ICE candidate send failed", err, logMetadata("sessionId", session.ID))
		}
	})

	peer.OnDataChannel(func(channel *webrtc.DataChannel) {
		if channel.Label() != "setulink-control" {
			return
		}
		logger("remote-desktop").Info("data-channel", "remote desktop control channel received", logMetadata("sessionId", session.ID, "label", channel.Label()))
		channel.OnOpen(func() {
			logger("remote-desktop").Info("data-channel", "remote desktop control channel open", logMetadata("sessionId", session.ID, "label", channel.Label()))
		})
		channel.OnClose(func() {
			logger("remote-desktop").Info("data-channel", "remote desktop control channel closed", logMetadata("sessionId", session.ID, "label", channel.Label()))
		})
		channel.OnMessage(func(message webrtc.DataChannelMessage) {
			control, err := agentremotedesktop.DecodeControlMessage(message.Data)
			if err != nil {
				logger("remote-desktop").Warn("input", "remote desktop input decode failed", err, logMetadata("sessionId", session.ID))
				return
			}
			if err := agentremotedesktop.InjectInput(control); err != nil {
				logger("remote-desktop").Warn("input", "remote desktop input injection failed", err, logMetadata("sessionId", session.ID))
			}
		})
	})

	peer.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		logger("remote-desktop").Info("peer-state", "remote desktop peer connection state changed", logMetadata("sessionId", session.ID, "state", state.String()))
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			cancelActiveRemoteDesktopRuntime(session.ID)
		}
	})
	peer.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		logger("remote-desktop").Info("ice-state", "remote desktop ICE connection state changed", logMetadata("sessionId", session.ID, "state", state.String()))
	})
	peer.OnICEGatheringStateChange(func(state webrtc.ICEGatheringState) {
		logger("remote-desktop").Info("ice-state", "remote desktop ICE gathering state changed", logMetadata("sessionId", session.ID, "state", state.String()))
	})
	peer.OnSignalingStateChange(func(state webrtc.SignalingState) {
		logger("remote-desktop").Info("signaling-state", "remote desktop signaling state changed", logMetadata("sessionId", session.ID, "state", state.String()))
	})

	if err := peer.SetRemoteDescription(*session.BrowserOffer); err != nil {
		return fmt.Errorf("consume browser offer: %w", err)
	}
	logger("remote-desktop").Info("offer-applied", "remote desktop browser offer applied", logMetadata("sessionId", session.ID))
	appliedBrowserIce := map[string]bool{}
	applyBrowserIceCandidates := func(candidates []webrtc.ICECandidateInit) {
		for _, candidate := range candidates {
			key := candidate.Candidate
			if key == "" {
				key = fmt.Sprintf("%+v", candidate)
			}
			if appliedBrowserIce[key] {
				continue
			}
			appliedBrowserIce[key] = true
			candidateType := remoteDesktopCandidateType(candidate.Candidate)
			if err := peer.AddICECandidate(candidate); err != nil {
				logger("remote-desktop").Warn("ice", "remote desktop browser ICE candidate rejected", err, logMetadata(
					"sessionId", session.ID,
					"candidateType", candidateType,
				))
			} else {
				logger("remote-desktop").Info("ice", "remote desktop browser ICE candidate applied", logMetadata(
					"sessionId", session.ID,
					"candidateType", candidateType,
				))
			}
		}
	}
	applyBrowserIceCandidates(session.BrowserIce)

	answer, err := peer.CreateAnswer(nil)
	if err != nil {
		return fmt.Errorf("create WebRTC answer: %w", err)
	}
	if err := peer.SetLocalDescription(answer); err != nil {
		return fmt.Errorf("set local WebRTC answer: %w", err)
	}

	if err := SendRemoteDesktopAnswer(cfg, session.ID, *peer.LocalDescription()); err != nil {
		return err
	}
	logger("remote-desktop").Info("answer-posted", "remote desktop WebRTC answer posted", logMetadata("sessionId", session.ID))
	if err := SendRemoteDesktopStatus(cfg, session.ID, "media_starting", "agent publishing desktop media"); err != nil {
		return err
	}
	logger("remote-desktop").Info("status-posted", "remote desktop media_starting status posted", logMetadata("sessionId", session.ID))
	go pollBrowserIce(ctx, cfg, session.ID, applyBrowserIceCandidates)
	go failRemoteDesktopIfMediaInactive(ctx, cfg, session.ID, remoteDesktopMediaActiveTimeout)

	if err := cmd.Start(); err != nil {
		agentremotedesktop.ReleaseCaptureResources(cmd)
		return fmt.Errorf("start ffmpeg desktop capture: %w", err)
	}
	logger("remote-desktop").Info("capture-started", "remote desktop ffmpeg capture process started", logMetadata("sessionId", session.ID))
	stderrResult := drainCaptureStderr(stderr)
	defer func() {
		_ = cmd.Kill()
		_ = cmd.Wait()
		agentremotedesktop.ReleaseCaptureResources(cmd)
	}()

	if err := publishIVF(ctx, session.ID, stdout, videoTrack); err != nil {
		if stderrText := waitCaptureStderr(stderrResult); stderrText != "" {
			classification := classifyCaptureStderr(stderrText)
			logger("remote-desktop").Warn("capture", "desktop capture stderr", fmt.Errorf("%s", stderrText), logMetadata(
				"sessionId", session.ID,
				"captureFailureClass", classification,
			))
			return fmt.Errorf("%w; capture failure class: %s; ffmpeg stderr: %s", err, classification, stderrText)
		}
		return fmt.Errorf("%w; capture failure class: no-frames-received", err)
	}
	return nil
}

func pollBrowserIce(ctx context.Context, cfg *Config, sessionID string, apply func([]webrtc.ICECandidateInit)) {
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			session, err := FetchRemoteDesktopSession(cfg, sessionID)
			if err != nil {
				logger("remote-desktop").Warn("ice", "remote desktop browser ICE poll failed", err, logMetadata("sessionId", sessionID))
				continue
			}
			if len(session.BrowserIce) > 0 {
				logger("remote-desktop").Info("ice", "remote desktop browser ICE poll returned candidates", logMetadata(
					"sessionId", sessionID,
					"browserIceCount", len(session.BrowserIce),
				))
				apply(session.BrowserIce)
			}
			if session.Status == "failed" || session.Status == "ended" || session.Status == "expired" || session.Status == "denied" {
				logger("remote-desktop").Info("ice", "remote desktop browser ICE polling stopped because session ended", logMetadata("sessionId", sessionID, "status", session.Status))
				return
			}
		}
	}
}

func failRemoteDesktopIfMediaInactive(ctx context.Context, cfg *Config, sessionID string, timeout time.Duration) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return
	case <-timer.C:
	}

	session, err := FetchRemoteDesktopSession(cfg, sessionID)
	if err != nil {
		logger("remote-desktop").Warn("media-timeout", "remote desktop media activation check failed", err, logMetadata("sessionId", sessionID))
		return
	}
	if session.Status != "media_starting" {
		logger("remote-desktop").Info("media-timeout", "remote desktop media activation timeout skipped because session status changed", logMetadata(
			"sessionId", sessionID,
			"status", session.Status,
		))
		return
	}

	reason := fmt.Sprintf("desktop media did not become active within %s after the WebRTC answer; check screen capture output and ICE/TURN connectivity", timeout)
	logger("remote-desktop").Warn("media-timeout", "remote desktop media did not become active before timeout", fmt.Errorf("%s", reason), logMetadata("sessionId", sessionID))
	if err := SendRemoteDesktopStatus(cfg, sessionID, "failed", reason); err != nil {
		recordAgentError("remote-desktop-status", err)
		logger("remote-desktop").Warn("status", "remote desktop media timeout status update failed", err, logMetadata("sessionId", sessionID))
		return
	}
	cancelActiveRemoteDesktopRuntime(sessionID)
}

func cancelActiveRemoteDesktopRuntime(sessionID string) {
	remoteDesktopRuntimes.Lock()
	runtime, ok := remoteDesktopRuntimes.active[sessionID]
	remoteDesktopRuntimes.Unlock()
	if ok {
		runtime.cancel()
	}
}

func publishIVF(ctx context.Context, sessionID string, reader io.Reader, track *webrtc.TrackLocalStaticSample) error {
	ivf, header, err := ivfreader.NewWith(reader)
	if err != nil {
		return fmt.Errorf("desktop capture did not produce VP8 IVF frames: %w", err)
	}
	if header.FourCC != "VP80" {
		return fmt.Errorf("desktop capture produced unsupported codec %s", header.FourCC)
	}
	logger("remote-desktop").Info("capture-frames", "desktop capture produced VP8 IVF stream", logMetadata("sessionId", sessionID, "codec", header.FourCC))

	frameDuration := time.Second / 24
	frameCount := 0
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		frame, _, err := ivf.ParseNextFrame()
		if err != nil {
			if err == io.EOF {
				return fmt.Errorf("desktop capture ended")
			}
			return fmt.Errorf("read desktop capture frame: %w", err)
		}
		if err := track.WriteSample(media.Sample{Data: frame, Duration: frameDuration}); err != nil {
			return fmt.Errorf("write desktop frame to WebRTC track: %w", err)
		}
		frameCount++
		if frameCount == 1 || frameCount == 12 || frameCount%120 == 0 {
			logger("remote-desktop").Info("track-write", "desktop frame written to WebRTC track", logMetadata("sessionId", sessionID, "frameCount", frameCount))
		}
	}
}

func remoteDesktopCandidateType(candidate string) string {
	fields := strings.Fields(candidate)
	for i := 0; i+1 < len(fields); i++ {
		if fields[i] == "typ" {
			return fields[i+1]
		}
	}
	return "unknown"
}

type captureStderrResult struct {
	text string
}

func drainCaptureStderr(reader io.Reader) <-chan captureStderrResult {
	result := make(chan captureStderrResult, 1)
	go func() {
		var buffer bytes.Buffer
		_, _ = io.Copy(&buffer, io.LimitReader(reader, 8192))
		result <- captureStderrResult{text: strings.TrimSpace(buffer.String())}
	}()
	return result
}

func waitCaptureStderr(result <-chan captureStderrResult) string {
	select {
	case data := <-result:
		return data.text
	case <-time.After(2 * time.Second):
		return ""
	}
}

func classifyCaptureStderr(stderrText string) string {
	lower := strings.ToLower(stderrText)
	switch {
	case strings.Contains(lower, "error 5") ||
		strings.Contains(lower, "access is denied") ||
		strings.Contains(lower, "permission denied"):
		return "gdigrab-access-denied"
	case strings.Contains(lower, "failed to capture image"):
		return "gdigrab-capture-failed"
	case strings.Contains(lower, "error opening input") ||
		strings.Contains(lower, "i/o error") ||
		strings.Contains(lower, "desktop: i/o error"):
		return "gdigrab-open-failure"
	case strings.Contains(lower, "error while opening encoder") ||
		strings.Contains(lower, "libvpx") ||
		strings.Contains(lower, "auto_alt_ref") ||
		strings.Contains(lower, "transparency encoding"):
		return "encoder-failure"
	default:
		return "capture-process-exited"
	}
}
