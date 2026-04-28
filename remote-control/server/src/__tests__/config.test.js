const assert = require('node:assert/strict');
const test = require('node:test');
const { isCorsOriginAllowed } = require('../config');

test('CORS allows local frontend origins', () => {
  assert.equal(isCorsOriginAllowed('http://localhost:3001'), true);
  assert.equal(isCorsOriginAllowed('http://127.0.0.1:3001'), true);
  assert.equal(isCorsOriginAllowed('http://192.168.68.100:3001'), true);
});

test('CORS rejects unrelated origins', () => {
  assert.equal(isCorsOriginAllowed('http://192.168.68.100:3002'), false);
  assert.equal(isCorsOriginAllowed('https://example.com'), false);
  assert.equal(isCorsOriginAllowed('not a url'), false);
});
