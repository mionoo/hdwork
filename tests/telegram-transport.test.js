const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const { createTelegramTransport } = require('../src/services/telegram-transport');

function request(port, endpoint, agent, extra = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: '127.0.0.1', port, path: endpoint, agent, rejectUnauthorized: false, ...extra }, res => {
      res.resume();
      res.once('error', reject);
      res.once('end', () => resolve({ reused: req.reusedSocket, socket: req.socket, status: res.statusCode }));
    });
    req.once('error', reject);
  });
}

test('TLS establishment has a deadline even when TCP connects and the server never answers', { timeout: 3000 }, async t => {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const transport = createTelegramTransport({ connectTimeoutMs: 100 });
  t.after(async () => { transport.destroy(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const agent = transport.agent(new URL('https://api.telegram.org/bottest/sendMessage'));
  assert.equal(agent.options.family, 4);
  await assert.rejects(request(server.address().port, '/', agent), { code: 'ETIMEDOUT' });
});

test('real TLS reuses IPv4 connections, retires idle sockets, and polls while all API slots are busy', {
  skip: spawnSync('openssl', ['version']).status !== 0 ? 'openssl is required for local TLS fixture' : false,
  timeout: 5000,
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hdwork-telegram-tls-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const hanging = [];
  let allBusy;
  const busy = new Promise(resolve => { allBusy = resolve; });
  const server = https.createServer({ key: fs.readFileSync(path.join(directory, 'key.pem')), cert: fs.readFileSync(path.join(directory, 'cert.pem')) }, (req, res) => {
    if (req.url === '/slow') { hanging.push(res); if (hanging.length === 8) allBusy(); }
    else res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const transport = createTelegramTransport({ idleTimeoutMs: 100, connectTimeoutMs: 1000 });
  t.after(async () => { transport.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const api = transport.agent(new URL('https://api.telegram.org/bottest/sendMessage'));
  const polling = transport.agent(new URL('https://api.telegram.org/bottest/getUpdates'));
  assert.notEqual(api, polling);
  const first = await request(server.address().port, '/', api);
  const second = await request(server.address().port, '/', api);
  assert.equal(second.reused, true);
  assert.equal(first.socket, second.socket);
  assert.equal(second.socket.remoteFamily, 'IPv4');
  await wait(180);
  const third = await request(server.address().port, '/', api);
  assert.notEqual(third.socket, first.socket);
  const uploads = Promise.all(Array.from({ length: 8 }, () => request(server.address().port, '/slow', api)));
  uploads.catch(() => {});
  await busy;
  assert.equal((await request(server.address().port, '/getUpdates', polling)).status, 200);
  for (const res of hanging) res.end('{}');
  await uploads;
});
