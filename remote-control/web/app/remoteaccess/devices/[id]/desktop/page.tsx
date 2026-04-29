'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { remoteAccessApiUrl, remoteAccessWsUrl } from '../../../apiBase';

type DesktopSession = {
  id: string;
  status: string;
  failureReason?: string | null;
};

type RemoteDesktopFrame = {
  sessionId: string;
  width: number;
  height: number;
  blob: Blob;
};

type ConnectState =
  | 'connecting'
  | 'waiting'
  | 'live'
  | 'failed'
  | 'disconnected';

const BINARY_MAGIC = 'RDF1';
const MOUSE_MOVE_COALESCE_MS = 30;
const VIEWPORT_UPDATE_DEBOUNCE_MS = 200;
const MAX_VIEWPORT_TARGET_WIDTH = 1920;
const MAX_VIEWPORT_TARGET_HEIGHT = 1080;

export default function DesktopViewerPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id || '');

  const [deviceName, setDeviceName] = useState('');
  const [state, setState] = useState<ConnectState>('connecting');
  const [message, setMessage] = useState('Connecting...');
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<DesktopSession | null>(null);
  const latestFrameRef = useRef<RemoteDesktopFrame | null>(null);
  const renderingFrameRef = useRef(false);
  const renderLoopRef = useRef<number | null>(null);
  const mediaActivatedRef = useRef(false);
  const connectStartedAtRef = useRef<number | null>(null);
  const firstFrameReceivedRef = useRef(false);
  const firstFrameRenderedRef = useRef(false);
  const latestMouseMoveRef = useRef<{ xRatio: number; yRatio: number } | null>(null);
  const mouseMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewportRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;

    fetch(remoteAccessApiUrl(`/api/remoteaccess/devices/${encodeURIComponent(id)}`), {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((r) => r.ok ? r.json() : null)
      .then((body) => {
        if (body?.device) {
          setDeviceName(body.device.displayName || body.device.hostname || id);
        }
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function start() {
      try {
        connectStartedAtRef.current = performance.now();
        firstFrameReceivedRef.current = false;
        firstFrameRenderedRef.current = false;
        const res = await fetch(remoteAccessApiUrl(`/api/remoteaccess/devices/${encodeURIComponent(id)}/connect`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (cancelled) return;
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState('failed');
          setMessage(body.error || 'Could not start remote desktop session.');
          return;
        }
        const session = body.desktopSession as DesktopSession | undefined;
        if (!session?.id) {
          setState('failed');
          setMessage('Remote desktop session was not created.');
          return;
        }
        sessionRef.current = session;
        logConnectTiming('session created');
        openSocket(session);
      } catch {
        if (!cancelled) {
          setState('failed');
          setMessage('Could not reach the server. Check your connection and try again.');
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      stopRenderLoop();
      clearMouseMoveTimer();
      clearViewportTimer();
    };
  // The connect effect is keyed only by device id; helper functions read current refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const resizeObserver = viewer && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleViewportUpdate)
      : null;
    if (viewer && resizeObserver) resizeObserver.observe(viewer);
    window.addEventListener('resize', scheduleViewportUpdate);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleViewportUpdate);
      clearViewportTimer();
    };
  // Viewport updates are debounced and sent through the current socket ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSocket(session: DesktopSession) {
    const socket = new WebSocket(
      remoteAccessWsUrl(`/api/remoteaccess/ws/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(session.id)}`)
    );
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    mediaActivatedRef.current = false;
    latestFrameRef.current = null;
    renderingFrameRef.current = false;
    startRenderLoop();

    socket.onopen = () => {
      setState('waiting');
      setMessage('WebSocket connected. Waiting for desktop frames...');
      logConnectTiming('browser websocket open');
      sendViewportUpdate();
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        void parseBinaryFrame(event.data).then((frame) => {
          if (!frame) return;
          if (!firstFrameReceivedRef.current) {
            firstFrameReceivedRef.current = true;
            logConnectTiming('first frame received');
          }
          latestFrameRef.current = frame;
        });
        return;
      }
      try {
        const msg = JSON.parse(String(event.data)) as { type: string; status?: string; reason?: string | null };
        if (msg.type === 'remote-desktop-status' && msg.status === 'failed') {
          setState('failed');
          setMessage(msg.reason || 'Remote desktop relay failed.');
        }
      } catch {}
    };

    socket.onclose = (event) => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        latestFrameRef.current = null;
        setState('disconnected');
        setMessage(event.reason || 'Remote desktop disconnected.');
      }
    };

    socket.onerror = () => {
      setState('failed');
      setMessage('WebSocket relay could not connect.');
    };
  }

  async function parseBinaryFrame(data: ArrayBuffer): Promise<RemoteDesktopFrame | null> {
    if (data.byteLength < 8) return null;
    const view = new DataView(data);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== BINARY_MAGIC) return null;
    const headerLength = view.getUint32(4, false);
    const headerStart = 8;
    const headerEnd = headerStart + headerLength;
    if (headerLength <= 0 || headerEnd > data.byteLength) return null;
    const header = JSON.parse(new TextDecoder().decode(data.slice(headerStart, headerEnd))) as {
      sessionId: string; width: number; height: number;
    };
    return { ...header, blob: new Blob([data.slice(headerEnd)], { type: 'image/jpeg' }) };
  }

  function startRenderLoop() {
    if (renderLoopRef.current !== null) return;
    const tick = () => {
      if (!renderingFrameRef.current && latestFrameRef.current) {
        const frame = latestFrameRef.current;
        latestFrameRef.current = null;
        renderingFrameRef.current = true;
        void drawFrame(frame).finally(() => {
          renderingFrameRef.current = false;
        });
      }
      renderLoopRef.current = window.requestAnimationFrame(tick);
    };
    renderLoopRef.current = window.requestAnimationFrame(tick);
  }

  function stopRenderLoop() {
    if (renderLoopRef.current !== null) {
      window.cancelAnimationFrame(renderLoopRef.current);
      renderLoopRef.current = null;
    }
    latestFrameRef.current = null;
    renderingFrameRef.current = false;
  }

  async function drawFrame(frame: RemoteDesktopFrame) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(frame.blob);
      const w = frame.width || bitmap.width;
      const h = frame.height || bitmap.height;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      setFrameSize({ width: w, height: h });
      if (!firstFrameRenderedRef.current) {
        firstFrameRenderedRef.current = true;
        logConnectTiming('first frame rendered');
      }
      void markMediaActive(frame.sessionId);
    } finally {
      bitmap?.close();
    }
  }

  async function markMediaActive(sessionId: string) {
    if (!sessionId || mediaActivatedRef.current) return;
    mediaActivatedRef.current = true;
    try {
      const res = await fetch(
        remoteAccessApiUrl(`/api/remoteaccess/desktop/sessions/${encodeURIComponent(sessionId)}/media-active`),
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.session) {
        setState('live');
        setMessage('Live');
      } else {
        mediaActivatedRef.current = false;
        setState('failed');
        setMessage(body.error || 'Session state could not be confirmed.');
      }
    } catch {
      mediaActivatedRef.current = false;
      setState('failed');
      setMessage('Session state could not be confirmed.');
    }
  }

  async function disconnect() {
    const sessionId = sessionRef.current?.id;
    socketRef.current?.close();
    socketRef.current = null;
    setState('disconnected');
    setMessage('Disconnected.');
    if (sessionId) {
      await fetch(
        remoteAccessApiUrl(`/api/remoteaccess/desktop/sessions/${encodeURIComponent(sessionId)}/end`),
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      ).catch(() => {});
    }
  }

  function sendControl(type: string, payload: Record<string, unknown>) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type, ...payload }));
  }

  function logConnectTiming(label: string) {
    const startedAt = connectStartedAtRef.current;
    if (startedAt === null) return;
    console.info(`[remote-desktop] ${label}`, {
      elapsedMs: Math.round(performance.now() - startedAt),
      deviceId: id,
      sessionId: sessionRef.current?.id || null,
    });
  }

  function clearMouseMoveTimer() {
    if (mouseMoveTimerRef.current !== null) {
      clearTimeout(mouseMoveTimerRef.current);
      mouseMoveTimerRef.current = null;
    }
  }

  function clearViewportTimer() {
    if (viewportTimerRef.current !== null) {
      clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = null;
    }
  }

  function scheduleViewportUpdate() {
    clearViewportTimer();
    viewportTimerRef.current = setTimeout(() => {
      viewportTimerRef.current = null;
      sendViewportUpdate();
    }, VIEWPORT_UPDATE_DEBOUNCE_MS);
  }

  function sendViewportUpdate() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const rect = viewer.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const target = fitSize(
      Math.max(1, Math.round(rect.width * dpr)),
      Math.max(1, Math.round(rect.height * dpr)),
      MAX_VIEWPORT_TARGET_WIDTH,
      MAX_VIEWPORT_TARGET_HEIGHT
    );
    const viewportKey = `${target.width}x${target.height}:${dpr}`;
    if (lastViewportRef.current === viewportKey) return;
    lastViewportRef.current = viewportKey;
    sendControl('viewport', {
      width: target.width,
      height: target.height,
      scaleMode: 'fit',
      devicePixelRatio: dpr,
    });
  }

  function flushMouseMove() {
    const latest = latestMouseMoveRef.current;
    latestMouseMoveRef.current = null;
    clearMouseMoveTimer();
    if (latest) sendControl('mouse_move', latest);
  }

  function sendCoalescedMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    latestMouseMoveRef.current = pointerRatio(event);
    if (mouseMoveTimerRef.current !== null) return;
    mouseMoveTimerRef.current = setTimeout(() => {
      mouseMoveTimerRef.current = null;
      const latest = latestMouseMoveRef.current;
      latestMouseMoveRef.current = null;
      if (latest) sendControl('mouse_move', latest);
    }, MOUSE_MOVE_COALESCE_MS);
  }

  function pointerRatio(event: React.MouseEvent<HTMLCanvasElement>) {
    const w = Math.max(1, event.currentTarget.clientWidth);
    const h = Math.max(1, event.currentTarget.clientHeight);
    return {
      xRatio: event.nativeEvent.offsetX / w,
      yRatio: event.nativeEvent.offsetY / h,
    };
  }

  const isLive = state === 'live' || state === 'waiting';

  return (
    <div style={root}>
      <div style={topBar}>
        <div style={topBarLeft}>
          <span style={deviceLabel}>{deviceName || id}</span>
          <span style={stateDot(state)} />
          <span style={stateText(state)}>{state === 'live' ? 'Live' : message}</span>
        </div>
        <div style={topBarRight}>
          {frameSize && (
            <span style={dimLabel}>{frameSize.width} × {frameSize.height}</span>
          )}
          <button type="button" onClick={disconnect} style={disconnectBtn}>
            Disconnect
          </button>
        </div>
      </div>

      <div
        ref={viewerRef}
        style={canvasWrap}
        tabIndex={0}
        onKeyDown={(e) => { e.preventDefault(); sendControl('key_down', { key: e.key, code: e.code }); }}
        onKeyUp={(e) => { e.preventDefault(); sendControl('key_up', { key: e.key, code: e.code }); }}
        onMouseEnter={scheduleViewportUpdate}
      >
        {!isLive && !frameSize && (
          <div style={overlay}>
            <div style={overlayBox}>
              <div style={spinner} />
              <p style={overlayMsg}>{message}</p>
              {(state === 'failed' || state === 'disconnected') && (
                <button type="button" onClick={() => window.location.reload()} style={retryBtn}>
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={frameSize ? canvasVisible : canvasHidden}
          onMouseMove={sendCoalescedMouseMove}
          onMouseDown={(e) => { flushMouseMove(); sendControl('mouse_down', { ...pointerRatio(e), button: e.button }); }}
          onMouseUp={(e) => { flushMouseMove(); sendControl('mouse_up', { ...pointerRatio(e), button: e.button }); }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Remote desktop"
        />
      </div>
    </div>
  );
}

function stateDot(state: ConnectState): React.CSSProperties {
  const color =
    state === 'live' ? '#22c55e' :
    state === 'waiting' || state === 'connecting' ? '#f59e0b' :
    '#ef4444';
  return {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  };
}

function fitSize(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function stateText(state: ConnectState): React.CSSProperties {
  const color =
    state === 'live' ? '#86efac' :
    state === 'waiting' || state === 'connecting' ? '#fcd34d' :
    '#fca5a5';
  return { color, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
}

const root: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100vw',
  height: '100vh',
  background: '#0f172a',
  overflow: 'hidden',
};

const topBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '0 14px',
  height: '42px',
  background: '#1e293b',
  borderBottom: '1px solid #334155',
  flexShrink: 0,
  fontFamily: 'Arial, sans-serif',
};

const topBarLeft: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
};

const topBarRight: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexShrink: 0,
};

const deviceLabel: React.CSSProperties = {
  color: '#f1f5f9',
  fontWeight: 700,
  fontSize: '14px',
  whiteSpace: 'nowrap',
};

const dimLabel: React.CSSProperties = {
  color: '#64748b',
  fontSize: '12px',
};

const disconnectBtn: React.CSSProperties = {
  padding: '5px 12px',
  border: '1px solid #475569',
  borderRadius: '5px',
  background: 'transparent',
  color: '#cbd5e1',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const canvasWrap: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  outline: 'none',
};

const canvasVisible: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  display: 'block',
  cursor: 'default',
  imageRendering: 'pixelated',
};

const canvasHidden: React.CSSProperties = {
  display: 'none',
};

const overlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const overlayBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '14px',
  padding: '32px 40px',
  background: '#1e293b',
  borderRadius: '12px',
  border: '1px solid #334155',
};

const overlayMsg: React.CSSProperties = {
  color: '#cbd5e1',
  fontSize: '15px',
  margin: 0,
  textAlign: 'center',
  fontFamily: 'Arial, sans-serif',
  maxWidth: '340px',
};

const retryBtn: React.CSSProperties = {
  padding: '8px 20px',
  border: '1px solid #3b82f6',
  borderRadius: '6px',
  background: '#3b82f6',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'Arial, sans-serif',
};

const spinner: React.CSSProperties = {
  width: '36px',
  height: '36px',
  border: '3px solid #334155',
  borderTopColor: '#3b82f6',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
};
