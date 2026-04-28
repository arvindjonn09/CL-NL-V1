function splitUrls(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function iceUrlTypes(urls) {
  return splitUrls(Array.isArray(urls) ? urls.join(',') : urls)
    .map((url) => String(url).split(':', 1)[0])
    .filter(Boolean);
}

function publicIceServerSummary(iceServers) {
  return iceServers.map((server) => ({
    urlTypes: Array.isArray(server.urls)
      ? server.urls.map((url) => String(url).split(':', 1)[0])
      : iceUrlTypes(server.urls),
    hasUsername: Boolean(server.username),
    hasCredential: Boolean(server.credential),
  }));
}

function iceServersFromEnv(env = process.env) {
  const stunUrls = splitUrls(env.WEBRTC_STUN_URLS);
  const turnUrls = splitUrls(env.WEBRTC_TURN_URLS);
  const iceServers = [];

  if (stunUrls.length) {
    iceServers.push({ urls: stunUrls });
  }

  if (turnUrls.length) {
    const turnServer = { urls: turnUrls };
    if (env.WEBRTC_TURN_USERNAME) turnServer.username = env.WEBRTC_TURN_USERNAME;
    if (env.WEBRTC_TURN_CREDENTIAL) turnServer.credential = env.WEBRTC_TURN_CREDENTIAL;
    iceServers.push(turnServer);
  }

  return iceServers;
}

function publicIceConfig(env = process.env) {
  const iceServers = iceServersFromEnv(env);
  const requireIceServers = env.WEBRTC_REQUIRE_ICE_SERVERS === 'true';
  return {
    iceServers,
    summary: publicIceServerSummary(iceServers),
    configured: iceServers.length > 0,
    usable: iceServers.length > 0 || !requireIceServers,
    mode: iceServers.length > 0 ? 'configured' : 'host-candidates-only',
    warning: iceServers.length > 0
      ? null
      : 'No STUN/TURN servers are configured; WebRTC may only work on the same network.',
  };
}

module.exports = {
  iceServersFromEnv,
  publicIceServerSummary,
  publicIceConfig,
};
