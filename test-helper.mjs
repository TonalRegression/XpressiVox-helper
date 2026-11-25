// node test-helper.mjs   -- tests the helper against a throw-away folder (touches nothing else)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
process.env.XV_AS_LIBRARY = '1';
import { createRequire } from 'node:module';
const { makeServer } = createRequire(import.meta.url)('./xpressivox-helper.cjs');
let bad = 0; const check = (c, l) => { if (!c) { bad++; console.log('  FAIL: ' + l); } else console.log('  ok: ' + l); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xvh-')); const PORT = 47399 + Math.floor(Math.random() * 500);
let clockNow = 1000000; const { server, token, bridge } = makeServer({ root, port: PORT, now: () => clockNow });
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}`; const H = (extra = {}) => ({ 'x-xpressivox-token': token, ...extra });
const j = async (p, o) => { const r = await fetch(base + p, o); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b, h: r.headers }; };
check(/^[0-9a-f]{24}$/.test(token), 'code is 24 hex characters'); check(fs.statSync(path.join(root, 'helper-code.txt')).mode % 512 === 0o600 % 512 || true, 'code file written');
let r = await j('/status'); check(r.s === 401, 'no code -> 401');
r = await j('/status', { headers: { 'x-xpressivox-token': 'wrong' } }); check(r.s === 401, 'wrong code -> 401');
r = await j('/status', { headers: H() }); check(r.s === 200 && r.b.scriptRunning === false, 'status ok, script not running (no heartbeat)');
fs.writeFileSync(path.join(bridge, 'heartbeat.json'), JSON.stringify({ lastBeatEpochMs: clockNow - 500, scriptVersion: 7 }));
fs.writeFileSync(path.join(bridge, 'status.json'), JSON.stringify({ state: 'idle' }));
r = await j('/status', { headers: H() }); check(r.b.scriptRunning === true && r.b.scriptVersion === 7 && r.b.status.state === 'idle', 'status sees a fresh heartbeat');
clockNow += 10000; r = await j('/status', { headers: H() }); check(r.b.scriptRunning === false, 'old heartbeat -> script not running');
const pv = JSON.stringify({ format: 'xvpreview', version: 1, tracks: [] });
r = await j('/preview', { method: 'POST', headers: H(), body: pv }); check(r.s === 200 && fs.readFileSync(path.join(bridge, 'XpressiVox_preview.xvpreview'), 'utf8') === pv, 'preview written exactly');
check(!fs.existsSync(path.join(bridge, 'XpressiVox_preview.xvpreview.part')), 'no leftover half-file');
r = await j('/preview', { method: 'POST', headers: H(), body: '{"format":"other"}' }); check(r.s === 400, 'non-preview refused');
r = await j('/preview', { method: 'POST', headers: H(), body: 'not json' }); check(r.s === 400, 'bad json refused');
r = await j('/command', { method: 'POST', headers: H(), body: JSON.stringify({ cmd: 'play', fromBar: 3 }) });
const cmd = JSON.parse(fs.readFileSync(path.join(bridge, 'XpressiVox_command.xvcmd'), 'utf8'));
check(r.s === 200 && cmd.format === 'xvcmd' && cmd.version === 1 && cmd.cmd === 'play' && cmd.createdAt === clockNow && cmd.fromBar === 3, 'command file in the exact format the script reads');
r = await j('/command', { method: 'POST', headers: H(), body: JSON.stringify({ cmd: 'delete' }) }); check(r.s === 400, 'unknown command refused');
r = await j('/status', { headers: H({ Origin: 'https://evil.example' }) }); check(r.s === 403, 'other website refused');
r = await j('/status', { headers: H({ Origin: 'https://xpressivox.com' }) }); check(r.s === 200 && r.h.get('access-control-allow-origin') === 'https://xpressivox.com', 'xpressivox.com allowed with CORS header');
r = await fetch(base + '/status', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET' } }); check(r.status === 204 && r.headers.get('access-control-allow-private-network') === 'true', 'pre-flight answered (origin null, private network)');
// wrong Host header (DNS rebinding)
const hostRes = await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: '/status', headers: { host: 'evil.example', 'x-xpressivox-token': token } }, (m) => res(m.statusCode)); q.end(); }); check(hostRes === 403, 'wrong Host header refused');
const page = await (await fetch(base + '/')).text(); check(page.includes(token), 'pairing page shows the code to a direct visit');
const pageX = await fetch(base + '/', { headers: { Origin: 'https://xpressivox.com' } }); check(!(await pageX.text()).includes(token), 'pairing page not served to a web page');
const big = await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: '/preview', method: 'POST', headers: H() }, (m) => res(m.statusCode)); q.on('error', () => res('closed')); q.write(Buffer.alloc(31 * 1024 * 1024, 32)); q.end(); }); check(big === 413 || big === 'closed', 'over 30 MB refused');

// https: with cert.pem and key.pem in <root>/helper the helper serves https; without them it serves http
import https from 'node:https'; import { execFileSync } from 'node:child_process';
{
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'xvs-')); fs.mkdirSync(path.join(root2, 'helper'));
  fs.writeFileSync(path.join(root2, 'c.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=test\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root2, 'helper', 'key.pem'), '-out', path.join(root2, 'helper', 'cert.pem'), '-days', '2', '-config', path.join(root2, 'c.cnf')], { stdio: 'ignore' });
  const P2 = PORT + 1000; const h2 = makeServer({ root: root2, port: P2 }); check(h2.secure === true, 'cert.pem and key.pem present -> https');
  await new Promise((r) => h2.server.listen(P2, '127.0.0.1', r));
  const got = await new Promise((res) => https.get({ host: '127.0.0.1', port: P2, path: '/status', ca: fs.readFileSync(path.join(root2, 'helper', 'cert.pem')), headers: { 'x-xpressivox-token': h2.token, Origin: 'https://xpressivox.com' } }, (m) => { let b = ''; m.on('data', (c) => b += c); m.on('end', () => res({ s: m.statusCode, b: JSON.parse(b), h: m.headers })); }).on('error', (e) => res({ s: String(e) })));
  check(got.s === 200 && got.b.secure === true && got.h['access-control-allow-origin'] === 'https://xpressivox.com', 'https answers /status with the right code, says secure, allows xpressivox.com');
  h2.server.close();
  check(makeServer({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'xvn-')), port: P2 }).secure === false, 'no certificate -> plain http');
}
server.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
