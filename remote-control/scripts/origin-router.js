#!/usr/bin/env node
const http = require('http');
const net = require('net');

const LISTEN_PORT = Number(process.env.ORIGIN_ROUTER_PORT || 3001);
const DEFAULT_TARGET = process.env.ORIGIN_ROUTER_DEFAULT || 'http://127.0.0.1:3201';

const ROUTES = new Map([
  ['netralink.shivomsangha.com', process.env.SETULINK_ORIGIN || 'http://127.0.0.1:3201'],
]);

function targetForHost(hostHeader) {
  const hostname = String(hostHeader || '').split(':', 1)[0].toLowerCase();
  return new URL(ROUTES.get(hostname) || DEFAULT_TARGET);
}

function proxyRequest(req, res) {
  const target = targetForHost(req.headers.host);
  const headers = { ...req.headers, host: target.host };
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';

  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`origin unavailable: ${error.message}\n`);
  });

  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  const target = targetForHost(req.headers.host);
  const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.entries({ ...req.headers, host: target.host })
          .map(([key, value]) => `${key}: ${value}`)
          .join('\r\n') +
        '\r\n\r\n'
    );
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on('error', () => socket.destroy());
}

const server = http.createServer(proxyRequest);
server.on('upgrade', proxyUpgrade);
server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`origin router listening on ${LISTEN_PORT}`);
});
