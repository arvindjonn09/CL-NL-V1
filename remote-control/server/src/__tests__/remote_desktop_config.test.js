const assert = require('node:assert/strict');
const test = require('node:test');
const { publicIceConfig } = require('../remoteDesktop/config');

test('publicIceConfig exposes redacted STUN/TURN summary', () => {
  const config = publicIceConfig({
    WEBRTC_STUN_URLS: 'stun:stun.example.com:19302',
    WEBRTC_TURN_URLS: 'turn:turn.example.com:3478,turns:turn.example.com:5349',
    WEBRTC_TURN_USERNAME: 'remote-user',
    WEBRTC_TURN_CREDENTIAL: 'secret',
  });

  assert.equal(config.configured, true);
  assert.equal(config.usable, true);
  assert.deepEqual(config.summary, [
    {
      urlTypes: ['stun'],
      hasUsername: false,
      hasCredential: false,
    },
    {
      urlTypes: ['turn', 'turns'],
      hasUsername: true,
      hasCredential: true,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(config.summary), /secret|remote-user/);
});
