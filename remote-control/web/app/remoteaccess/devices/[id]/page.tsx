'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { formatDate, healthLabel, shortText, statusBadge } from '../../../devices/statusStyles';
import { remoteAccessApiUrl } from '../../apiBase';

type DeviceDetail = {
  device: {
    id: string;
    hostname?: string | null;
    displayName?: string | null;
    environmentLabel?: string | null;
    username?: string | null;
    os?: string | null;
    online?: boolean;
    status: string;
    connectionStatus?: string | null;
    healthStatus: string;
    healthLabel?: string | null;
    healthReason?: string | null;
    runMode?: string | null;
    agentVersion?: string | null;
    lastSeen?: string | null;
    heartbeatAgeSeconds?: number | null;
  };
  heartbeatSummary?: {
    recentCount: number;
    latest?: {
      run_mode?: string | null;
      agent_version?: string | null;
      process_id?: number | null;
      created_at?: string | null;
    } | null;
  };
  recentCommands: Array<{
    command_id: string;
    command: string;
    status: string;
    command_created_at?: string | null;
    completed_at?: string | null;
    exit_code?: number | null;
  }>;
  remoteConnect?: {
    available: boolean;
    state?: string | null;
    reason?: string | null;
    label?: string | null;
    transport?: {
      wired?: boolean;
      state?: string | null;
    } | null;
  };
  remoteDesktop?: {
    supported: boolean;
    available: boolean;
    state?: string | null;
    reason?: string | null;
    label?: string | null;
    ice?: {
      iceServers?: RTCIceServer[];
      configured?: boolean;
      mode?: string;
      warning?: string | null;
    };
    runtime?: {
      webrtcSignaling?: string;
      screenCapture?: string;
      input?: string;
      mediaTransport?: string;
      agentState?: string;
      reason?: string | null;
    };
  };
  recentRemoteDesktopSessions?: Array<{
    id: string;
    status: string;
    signaling_state?: string | null;
    transport_state?: string | null;
    created_at?: string | null;
    ended_at?: string | null;
    failure_reason?: string | null;
  }>;
};

type ConnectMode = 'idle' | 'available' | 'connecting' | 'waiting' | 'signaling' | 'connected' | 'disconnected' | 'expired' | 'unavailable' | 'failed';

type DesktopSession = {
  id: string;
  status: string;
  signalingState?: string | null;
  transportState?: string | null;
  failureReason?: string | null;
  agentAnswer?: RTCSessionDescriptionInit | null;
  agentIce?: RTCIceCandidateInit[];
  ice?: {
    iceServers?: RTCIceServer[];
    summary?: Array<{
      urlTypes?: string[];
      hasUsername?: boolean;
      hasCredential?: boolean;
    }>;
    warning?: string | null;
    mode?: string;
  };
};

function browserIceCandidateType(candidate?: RTCIceCandidateInit | RTCIceCandidate | null) {
  const text = String(candidate?.candidate || '');
  const match = text.match(/\btyp\s+([a-z0-9-]+)/i);
  return match ? match[1] : 'unknown';
}

export default function RemoteAccessDevicePage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id || '');
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [mode, setMode] = useState<'loading' | 'ready' | 'denied' | 'login' | 'error'>('loading');
  const [connectMode, setConnectMode] = useState<ConnectMode>('idle');
  const [connectMessage, setConnectMessage] = useState('');
  const [desktopSession, setDesktopSession] = useState<DesktopSession | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlRef = useRef<RTCDataChannel | null>(null);
  const appliedAgentIce = useRef(new Set<string>());
  const mediaActivatedRef = useRef(false);
  const peerDisconnectTimerRef = useRef<number | null>(null);
  const selectedPairLogRef = useRef('');

  function desktopLog(stage: string, fields: Record<string, unknown> = {}) {
    const sessionId = fields.sessionId || desktopSession?.id || 'pending';
    console.info('remote-desktop', { stage, sessionId, ...fields });
  }

  async function logSelectedCandidatePair(peer: RTCPeerConnection, sessionId: string, stage: string) {
    try {
      const stats = await peer.getStats();
      let selectedPair: RTCStats | null = null;
      stats.forEach((report) => {
        if (report.type === 'transport') {
          const selectedCandidatePairId = (report as RTCTransportStats).selectedCandidatePairId;
          if (selectedCandidatePairId) selectedPair = stats.get(selectedCandidatePairId) || selectedPair;
        }
      });
      stats.forEach((report) => {
        const looseReport = report as RTCIceCandidatePairStats & { selected?: boolean };
        if (!selectedPair && report.type === 'candidate-pair' && looseReport.selected) {
          selectedPair = report;
        }
      });
      if (!selectedPair) return;
      const pair = selectedPair as RTCIceCandidatePairStats;
      const local = stats.get(pair.localCandidateId || '') as (RTCStats & { candidateType?: string }) | undefined;
      const remote = stats.get(pair.remoteCandidateId || '') as (RTCStats & { candidateType?: string }) | undefined;
      const key = `${stage}:${local?.candidateType || 'unknown'}:${remote?.candidateType || 'unknown'}:${pair.state}`;
      if (selectedPairLogRef.current === key) return;
      selectedPairLogRef.current = key;
      desktopLog('selected-candidate-pair', {
        sessionId,
        stage,
        state: pair.state,
        localCandidateType: local?.candidateType || 'unknown',
        remoteCandidateType: remote?.candidateType || 'unknown',
        nominated: pair.nominated,
      });
    } catch (err) {
      desktopLog('selected-candidate-pair-unavailable', {
        sessionId,
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function clearPeerDisconnectTimer() {
    if (peerDisconnectTimerRef.current === null) return;
    window.clearTimeout(peerDisconnectTimerRef.current);
    peerDisconnectTimerRef.current = null;
  }

  useEffect(() => () => {
    if (peerDisconnectTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectTimerRef.current);
      peerDisconnectTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDevice() {
      try {
        const res = await fetch(remoteAccessApiUrl(`/api/remoteaccess/devices/${encodeURIComponent(id)}`), {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!active) return;
        if (res.status === 401) {
          setMode('login');
          return;
        }
        if (res.status === 404 || res.status === 403) {
          setMode('denied');
          return;
        }
        if (!res.ok) {
          setMode('error');
          return;
        }
        setDetail(await res.json());
        setMode('ready');
      } catch {
        if (active) setMode('error');
      }
    }

    if (id) loadDevice();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      desktopLog('video-src-object-attached', {
        trackCount: remoteStream.getTracks().length,
        videoTrackCount: remoteStream.getVideoTracks().length,
      });
    }
  }, [remoteStream]);

  async function applyAgentSignals(session: DesktopSession) {
    const peer = peerRef.current;
    if (!peer) return;
    if (session.agentAnswer && !peer.currentRemoteDescription) {
      await peer.setRemoteDescription(session.agentAnswer);
      desktopLog('remote-answer-applied', {
        sessionId: session.id,
        signalingState: peer.signalingState,
      });
    }
    if (!peer.currentRemoteDescription) return;
    for (const candidate of session.agentIce || []) {
      const key = JSON.stringify(candidate);
      if (appliedAgentIce.current.has(key)) continue;
      await peer.addIceCandidate(candidate).then(() => {
        appliedAgentIce.current.add(key);
        desktopLog('agent-ice-applied', {
          sessionId: session.id,
          candidateType: browserIceCandidateType(candidate),
        });
      }).catch((err) => {
        desktopLog('agent-ice-rejected', {
          sessionId: session.id,
          candidateType: browserIceCandidateType(candidate),
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  useEffect(() => {
    if (!desktopSession || connectMode === 'connected' || connectMode === 'failed' || connectMode === 'expired') {
      return undefined;
    }

    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(remoteAccessApiUrl(`/api/remoteaccess/desktop/sessions/${encodeURIComponent(desktopSession.id)}`), {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!active || !res.ok) return;
        const body = await res.json();
        const session = body.session as DesktopSession;
        setDesktopSession(session);
        await applyAgentSignals(session);

        if (session.status === 'connected' && remoteStream) {
          setConnectMode('connected');
          setConnectMessage('Remote desktop media is live.');
        } else if (session.status === 'failed') {
          setConnectMode('failed');
          setConnectMessage(session.failureReason || (session.transportState === 'failed' ? 'Remote desktop failed.' : 'Remote desktop is not ready on the device yet.'));
        } else if (session.status === 'expired') {
          setConnectMode('expired');
          setConnectMessage('Remote desktop session expired.');
        } else if (session.status === 'ended') {
          setConnectMode('disconnected');
          setConnectMessage('Remote desktop session ended.');
        } else if (session.status === 'media_starting') {
          setConnectMode('waiting');
          setConnectMessage('Device answered. Waiting for live desktop media...');
        } else if (session.signalingState === 'offer-received' || session.status === 'signaling' || session.status === 'waiting_for_agent') {
          setConnectMode('waiting');
          setConnectMessage('Waiting for the device to answer the WebRTC offer...');
        }
      } catch {
        if (active) {
          setConnectMode('failed');
          setConnectMessage('Could not update remote desktop session state.');
        }
      }
    }, 750);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [desktopSession, connectMode, remoteStream]);

  async function connect() {
    setConnectMode('connecting');
    setConnectMessage('Preparing unattended remote desktop session...');
    try {
      const res = await fetch(remoteAccessApiUrl(`/api/remoteaccess/devices/${encodeURIComponent(id)}/connect`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setConnectMode('failed');
        setConnectMessage('Your remote-access session expired. Sign in again to continue.');
        return;
      }
      if (!res.ok) {
        setConnectMode(res.status === 409 || res.status === 503 ? 'unavailable' : 'failed');
        setConnectMessage(body.error || 'Remote connection is not available right now.');
        return;
      }

      const session = body.desktopSession as DesktopSession | undefined;
      if (!session?.id) {
        setConnectMode('failed');
        setConnectMessage('Remote desktop session was not created.');
        return;
      }
      setDesktopSession(session);
      await startWebRtcSignaling(session);
    } catch {
      setConnectMode('failed');
      setConnectMessage('Could not prepare the remote session. Try again shortly.');
    }
  }

  async function startWebRtcSignaling(session: DesktopSession) {
    if (!('RTCPeerConnection' in window)) {
      setConnectMode('failed');
      setConnectMessage('This browser does not support WebRTC remote desktop sessions.');
      return;
    }

    setConnectMode('signaling');
    setConnectMessage('Creating WebRTC offer...');
    const peer = new RTCPeerConnection({
      iceServers: session.ice?.iceServers || [],
    });
    desktopLog('peer-created', {
      sessionId: session.id,
      iceMode: session.ice?.mode || null,
      iceServerSummary: session.ice?.summary || [],
    });
    peerRef.current = peer;
    appliedAgentIce.current = new Set();
    clearPeerDisconnectTimer();
    selectedPairLogRef.current = '';

    controlRef.current = peer.createDataChannel('setulink-control');
    controlRef.current.onopen = () => {
      desktopLog('data-channel-open', { sessionId: session.id });
      setConnectMode('waiting');
      setConnectMessage('Control channel ready. Waiting for desktop media...');
    };
    controlRef.current.onclose = () => {
      desktopLog('data-channel-close', { sessionId: session.id });
      if (connectMode === 'connected') {
        setConnectMode('disconnected');
        setConnectMessage('Remote desktop control channel closed.');
      }
    };

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      desktopLog('track-received', {
        sessionId: session.id,
        trackKind: event.track.kind,
        streamCount: event.streams.length,
      });
      if (stream) setRemoteStream(stream);
    };
    peer.onicegatheringstatechange = () => {
      desktopLog('ice-gathering-state', {
        sessionId: session.id,
        state: peer.iceGatheringState,
      });
    };
    peer.oniceconnectionstatechange = () => {
      desktopLog('ice-connection-state', {
        sessionId: session.id,
        state: peer.iceConnectionState,
      });
      void logSelectedCandidatePair(peer, session.id, `ice-${peer.iceConnectionState}`);
    };
    peer.onsignalingstatechange = () => {
      desktopLog('signaling-state', {
        sessionId: session.id,
        state: peer.signalingState,
      });
    };
    peer.onconnectionstatechange = () => {
      desktopLog('peer-connection-state', {
        sessionId: session.id,
        state: peer.connectionState,
        iceConnectionState: peer.iceConnectionState,
        signalingState: peer.signalingState,
      });
      void logSelectedCandidatePair(peer, session.id, `peer-${peer.connectionState}`);
      if (peer.connectionState === 'connected') {
        clearPeerDisconnectTimer();
        setConnectMode('waiting');
        setConnectMessage('WebRTC peer connected. Waiting for live desktop media...');
      }
      if (peer.connectionState === 'disconnected') {
        setConnectMode('waiting');
        setConnectMessage('WebRTC connection was interrupted. Waiting for it to recover...');
        clearPeerDisconnectTimer();
        peerDisconnectTimerRef.current = window.setTimeout(() => {
          peerDisconnectTimerRef.current = null;
          if (peerRef.current !== peer) return;
          if (peer.connectionState !== 'disconnected') return;
          setConnectMode('disconnected');
          setConnectMessage('Remote desktop WebRTC connection is no longer active.');
        }, 10000);
      }
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        clearPeerDisconnectTimer();
        setConnectMode(peer.connectionState === 'failed' ? 'failed' : 'disconnected');
        setConnectMessage('Remote desktop WebRTC connection is no longer active.');
      }
    };
    peer.onicecandidate = async (event) => {
      if (!event.candidate) {
        desktopLog('browser-ice-gathering-complete', { sessionId: session.id });
        return;
      }
      desktopLog('browser-ice-generated', {
        sessionId: session.id,
        candidateType: browserIceCandidateType(event.candidate),
      });
      await fetch(remoteAccessApiUrl(`/api/remoteaccess/desktop/sessions/${encodeURIComponent(session.id)}/ice`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: event.candidate.toJSON() }),
      }).catch(() => {});
    };

    const offer = await peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: true,
    });
    await peer.setLocalDescription(offer);
    desktopLog('local-offer-created', {
      sessionId: session.id,
      signalingState: peer.signalingState,
    });
    const offerRes = await fetch(remoteAccessApiUrl(`/api/remoteaccess/desktop/sessions/${encodeURIComponent(session.id)}/offer`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer }),
    });
    if (!offerRes.ok) {
      setConnectMode('failed');
      setConnectMessage('WebRTC signaling offer was rejected.');
      return;
    }
    setConnectMode('waiting');
    setConnectMessage(session.ice?.warning || 'Waiting for the device to answer the WebRTC offer...');
  }

  async function markMediaActive() {
    if (!desktopSession?.id || mediaActivatedRef.current) return;
    mediaActivatedRef.current = true;
    desktopLog('media-active-posting', {
      sessionId: desktopSession.id,
      videoReadyState: videoRef.current?.readyState || null,
      videoWidth: videoRef.current?.videoWidth || null,
      videoHeight: videoRef.current?.videoHeight || null,
    });
    try {
      const res = await fetch(remoteAccessApiUrl(`/api/remoteaccess/desktop/sessions/${encodeURIComponent(desktopSession.id)}/media-active`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.session) {
        desktopLog('media-active-acknowledged', {
          sessionId: desktopSession.id,
          videoReadyState: videoRef.current?.readyState || null,
          videoWidth: videoRef.current?.videoWidth || null,
          videoHeight: videoRef.current?.videoHeight || null,
        });
        setDesktopSession(body.session);
        setConnectMode('connected');
        setConnectMessage('Remote desktop media is live.');
        return;
      }
      mediaActivatedRef.current = false;
      desktopLog('media-active-rejected', {
        sessionId: desktopSession.id,
        error: body.error || null,
      });
      setConnectMode('failed');
      setConnectMessage(body.error || 'Desktop media arrived, but the session state could not be confirmed.');
    } catch {
      mediaActivatedRef.current = false;
      desktopLog('media-active-failed', {
        sessionId: desktopSession.id,
      });
      setConnectMode('failed');
      setConnectMessage('Desktop media arrived, but the session state could not be confirmed.');
    }
  }

  async function endDesktopSession() {
    const sessionId = desktopSession?.id;
    clearPeerDisconnectTimer();
    peerRef.current?.close();
    peerRef.current = null;
    controlRef.current = null;
    mediaActivatedRef.current = false;
    setRemoteStream(null);
    setConnectMode('disconnected');
    setConnectMessage('Remote desktop session ended.');
    if (sessionId) {
      await fetch(remoteAccessApiUrl(`/api/remoteaccess/desktop/sessions/${encodeURIComponent(sessionId)}/end`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {});
    }
  }

  function sendControl(type: string, payload: Record<string, unknown>) {
    const channel = controlRef.current;
    if (connectMode !== 'connected' || !desktopSession || !channel || channel.readyState !== 'open') return;
    channel.send(JSON.stringify({ type, ...payload }));
  }

  function pointerPayload(event: React.MouseEvent<HTMLDivElement>, includeButton = false) {
    const width = Math.max(1, event.currentTarget.clientWidth);
    const height = Math.max(1, event.currentTarget.clientHeight);
    return {
      xRatio: event.nativeEvent.offsetX / width,
      yRatio: event.nativeEvent.offsetY / height,
      ...(includeButton ? { button: event.button } : {}),
    };
  }

  return (
    <main style={page}>
      <section style={shell}>
        <header style={header}>
          <div>
            <Link href="/remoteaccess" style={backLink}>Back to remote access</Link>
            <h1 style={title}>{detail?.device.displayName || detail?.device.hostname || 'Device Detail'}</h1>
            <p style={subtitle}>Read-only status for this assigned device.</p>
          </div>
        </header>

        {mode === 'loading' && <p style={muted}>Loading device...</p>}

        {mode === 'login' && (
          <div style={panel}>
            <h2 style={sectionTitle}>Session required</h2>
            <p style={muted}>Sign in again to view remote-access devices.</p>
            <Link href="/remoteaccess" style={buttonLink}>Sign in</Link>
          </div>
        )}

        {mode === 'denied' && (
          <div style={panel}>
            <h2 style={sectionTitle}>Device unavailable</h2>
            <p style={muted}>This device is not available for this remote-access account.</p>
          </div>
        )}

        {mode === 'error' && (
          <div style={panel}>
            <h2 style={sectionTitle}>Could not load device</h2>
            <p style={muted}>The device status endpoint is unavailable right now.</p>
          </div>
        )}

        {mode === 'ready' && detail && (
          <div style={contentGrid}>
            <section style={panel}>
              <div style={statusRow}>
                <span style={statusBadge(detail.device.status)}>{detail.device.status}</span>
                <span style={statusBadge(detail.device.healthStatus)}>
                  {detail.device.healthLabel || healthLabel(detail.device.healthStatus)}
                </span>
              </div>
              <div style={detailGrid}>
                <DetailItem label="Hostname" value={detail.device.hostname || '-'} />
                <DetailItem label="Environment" value={detail.device.environmentLabel || 'unknown'} />
                <DetailItem label="User" value={detail.device.username || '-'} />
                <DetailItem label="OS" value={detail.device.os || '-'} />
                <DetailItem label="Run mode" value={detail.device.runMode || '-'} />
                <DetailItem label="Agent version" value={detail.device.agentVersion || '-'} />
                <DetailItem label="Last seen" value={formatDate(detail.device.lastSeen)} />
                <DetailItem label="Heartbeat age" value={detail.device.heartbeatAgeSeconds == null ? '-' : `${detail.device.heartbeatAgeSeconds}s`} />
              </div>
              {detail.device.healthReason && <p style={reason}>{detail.device.healthReason}</p>}
            </section>

            <section style={panel}>
              <h2 style={sectionTitle}>Heartbeat Summary</h2>
              <div style={detailGrid}>
                <DetailItem label="Recent heartbeats" value={String(detail.heartbeatSummary?.recentCount ?? 0)} />
                <DetailItem label="Latest heartbeat" value={formatDate(detail.heartbeatSummary?.latest?.created_at)} />
                <DetailItem label="Latest run mode" value={detail.heartbeatSummary?.latest?.run_mode || detail.device.runMode || '-'} />
                <DetailItem label="Latest agent" value={detail.heartbeatSummary?.latest?.agent_version || detail.device.agentVersion || '-'} />
              </div>
            </section>

            <section style={panel}>
              <h2 style={sectionTitle}>Remote Connection</h2>
              <p style={muted}>{detail.remoteDesktop?.label || detail.remoteConnect?.label || 'Remote desktop is not available in this portal yet.'}</p>
              {detail.remoteDesktop?.ice?.warning && <p style={warning}>{detail.remoteDesktop.ice.warning}</p>}
              <div style={capabilityGrid}>
                <DetailItem label="Signaling" value={detail.remoteDesktop?.runtime?.webrtcSignaling || 'unavailable'} />
                <DetailItem label="Screen capture" value={detail.remoteDesktop?.runtime?.screenCapture || 'not_ready'} />
                <DetailItem label="Input" value={detail.remoteDesktop?.runtime?.input || 'not_ready'} />
              </div>
              {detail.remoteDesktop?.available ? (
                <button
                  type="button"
                  onClick={connect}
                  disabled={connectMode === 'connecting' || connectMode === 'signaling' || connectMode === 'waiting'}
                  style={{
                    ...button,
                    ...(connectMode === 'connecting' || connectMode === 'signaling' || connectMode === 'waiting' ? disabledButton : {}),
                  }}
                >
                  {connectMode === 'connecting' || connectMode === 'signaling' ? 'Connecting...' : 'Connect'}
                </button>
              ) : (
                <div style={statePill}>
                  {detail.remoteDesktop?.state === 'offline'
                    ? 'Device offline'
                    : detail.remoteDesktop?.state === 'not_ready'
                      ? 'Connect not ready yet'
                      : 'Remote desktop unavailable'}
                </div>
              )}
              {desktopSession && <button type="button" onClick={endDesktopSession} style={secondaryButton}>Disconnect</button>}
              {connectMode !== 'idle' && (
                <p style={connectStatus(connectMode)}>{connectMessage}</p>
              )}
              <div
                style={viewer}
                tabIndex={0}
                onMouseMove={(event) => sendControl('mouse_move', pointerPayload(event))}
                onMouseDown={(event) => sendControl('mouse_down', pointerPayload(event, true))}
                onMouseUp={(event) => sendControl('mouse_up', pointerPayload(event, true))}
                onKeyDown={(event) => sendControl('key_down', { key: event.key, code: event.code })}
                onKeyUp={(event) => sendControl('key_up', { key: event.key, code: event.code })}
              >
                {remoteStream ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={video}
                    onLoadedData={() => {
                      desktopLog('video-loadeddata');
                      void markMediaActive();
                    }}
                    onPlaying={() => {
                      desktopLog('video-playing');
                      void markMediaActive();
                    }}
                    onError={() => desktopLog('video-error', {
                      errorCode: videoRef.current?.error?.code || null,
                      errorMessage: videoRef.current?.error?.message || null,
                    })}
                  />
                ) : (
                  <div style={viewerEmpty}>
                    {connectMode === 'connected'
                      ? 'Waiting for desktop media confirmation.'
                      : 'Remote desktop video will appear here when the agent capture runtime is ready.'}
                  </div>
                )}
              </div>
              {detail.recentRemoteDesktopSessions?.length ? (
                <div style={sessionList}>
                  {detail.recentRemoteDesktopSessions.map((session) => (
                    <div key={session.id} style={sessionRow}>
                      <span>{session.status}</span>
                      <span>{formatDate(session.created_at)}</span>
                      {session.failure_reason && <span>{shortText(session.failure_reason, 80)}</span>}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section style={panel}>
              <h2 style={sectionTitle}>Recent Commands</h2>
              {detail.recentCommands.length === 0 ? (
                <p style={muted}>No recent command history is visible.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Command</th>
                      <th style={th}>Status</th>
                      <th style={th}>Queued</th>
                      <th style={th}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentCommands.map((command) => (
                      <tr key={command.command_id}>
                        <td style={td}>{shortText(command.command, 120)}</td>
                        <td style={td}><span style={statusBadge(command.status)}>{command.status}</span></td>
                        <td style={td}>{formatDate(command.command_created_at)}</td>
                        <td style={td}>{formatDate(command.completed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={detailLabel}>{label}</div>
      <div style={detailValue}>{value}</div>
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f8fafc',
  padding: '32px 18px',
  fontFamily: 'Arial, sans-serif',
};

const shell: React.CSSProperties = {
  maxWidth: '980px',
  margin: '0 auto',
};

const header: React.CSSProperties = {
  marginBottom: '18px',
};

const backLink: React.CSSProperties = {
  color: '#2563eb',
  fontWeight: 700,
  textDecoration: 'none',
};

const title: React.CSSProperties = {
  margin: '10px 0 0',
};

const subtitle: React.CSSProperties = {
  marginTop: '6px',
  color: '#475569',
};

const contentGrid: React.CSSProperties = {
  display: 'grid',
  gap: '14px',
};

const panel: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  background: '#fff',
  padding: '16px',
};

const sectionTitle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: '12px',
};

const muted: React.CSSProperties = {
  color: '#64748b',
};

const buttonLink: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 14px',
  border: '1px solid #2563eb',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
};

const button: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 14px',
  border: '1px solid #2563eb',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  display: 'inline-block',
  marginLeft: '8px',
  padding: '10px 14px',
  border: '1px solid #64748b',
  borderRadius: '6px',
  background: '#fff',
  color: '#334155',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledButton: React.CSSProperties = {
  opacity: 0.7,
  cursor: 'wait',
};

const statePill: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  color: '#334155',
  background: '#f8fafc',
  fontSize: '13px',
  fontWeight: 700,
};

const warning: React.CSSProperties = {
  color: '#92400e',
  fontSize: '14px',
};

const capabilityGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '10px',
  marginBottom: '14px',
};

const viewer: React.CSSProperties = {
  marginTop: '14px',
  width: '100%',
  aspectRatio: '16 / 9',
  border: '1px solid #1f2937',
  borderRadius: '6px',
  background: '#0f172a',
  color: '#cbd5e1',
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden',
  outline: 'none',
};

const viewerEmpty: React.CSSProperties = {
  padding: '18px',
  textAlign: 'center',
  fontSize: '14px',
};

const video: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  background: '#000',
};

const sessionList: React.CSSProperties = {
  marginTop: '12px',
  display: 'grid',
  gap: '6px',
};

const sessionRow: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  color: '#475569',
  fontSize: '13px',
};

function connectStatus(state: ConnectMode): React.CSSProperties {
  const color = state === 'connected'
    ? '#166534'
    : state === 'unavailable' || state === 'expired' || state === 'waiting'
      ? '#92400e'
      : state === 'failed'
        ? '#991b1b'
        : '#334155';

  return {
    marginBottom: 0,
    color,
    fontSize: '14px',
  };
}

const statusRow: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  marginBottom: '16px',
};

const detailGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '14px',
};

const detailLabel: React.CSSProperties = {
  color: '#64748b',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
};

const detailValue: React.CSSProperties = {
  marginTop: '4px',
  color: '#0f172a',
  overflowWrap: 'anywhere',
};

const reason: React.CSSProperties = {
  marginBottom: 0,
  color: '#334155',
  fontSize: '14px',
};

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const th: React.CSSProperties = {
  border: '1px solid #d1d5db',
  padding: '8px',
  background: '#f9fafb',
  textAlign: 'left',
  fontSize: '13px',
};

const td: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  padding: '8px',
  verticalAlign: 'top',
  fontSize: '13px',
};
