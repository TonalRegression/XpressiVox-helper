// xpressivox-helper.mjs  --  XpressiVox's own small local helper (version 2). Written fresh; no code from SV-MCP.
// No installs needed beyond Node itself: it uses only what Node already includes.
//
// WHAT IT DOES, in plain words
//   * Listens ONLY on this computer (127.0.0.1, port 47321). Nothing outside your computer can reach it.
//   * Hands the XpressiVox page's preview file straight to the Synth V script's bridge folder (no Downloads file).
//   * Passes Play / Pause / Stop presses the same way, and reports what the Synth V script says it is doing.
//   * Every request must carry a secret code (the "pairing code") that only you and the page know.
//   * It never reads or writes anything except the bridge folder and its own code file.
// RUN:  node xpressivox-helper.cjs        SHOW THE CODE:  node xpressivox-helper.cjs --code        VERSION:  --version
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const https = require('node:https');

const HELPER_VERSION = 2;
const PORT = Number(process.env.XV_PORT || 47321);
const MAX_BYTES = 30 * 1024 * 1024;

function rootFolder(env = process.env, platform = process.platform) {
  if (env.XV_ROOT) return env.XV_ROOT;
  const home = os.homedir();
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'XpressiVox');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'XpressiVox');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'XpressiVox');
}

const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?xpressivox\.com$/, /^null$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const originOk = (o) => typeof o === 'string' && ALLOWED_ORIGINS.some((r) => r.test(o));
const hostOk = (h, port) => typeof h === 'string' && [`127.0.0.1:${port}`, `localhost:${port}`].includes(h.toLowerCase());

function writeAtomic(file, data) {
  const tmp = file + '.part';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function makeServer({ root, port = PORT, now = () => Date.now(), tls }) {
  const bridge = path.join(root, 'bridge');
  fs.mkdirSync(bridge, { recursive: true });
  const tokenFile = path.join(root, 'helper-code.txt');
  let token;
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { token = ''; }
  if (!/^[0-9a-f]{24}$/.test(token)) {
    token = crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
  }
  const send = (res, code, body, headers = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(text);
  };
  // v2: if cert.pem and key.pem are in the helper folder, serve https (the installer makes a certificate that vouches only for 127.0.0.1 and localhost)
  let secure = false, tlsOpts = null;
  if (tls !== false) {
    try { tlsOpts = tls || { key: fs.readFileSync(path.join(root, 'helper', 'key.pem')), cert: fs.readFileSync(path.join(root, 'helper', 'cert.pem')) }; secure = true; } catch { tlsOpts = null; }
  }
  const handler = (req, res) => {
    const origin = req.headers.origin;
    const cors = {};
    if (originOk(origin)) {
      cors['Access-Control-Allow-Origin'] = origin;
      cors['Vary'] = 'Origin';
      cors['Access-Control-Allow-Headers'] = 'content-type, x-xpressivox-token, x-xpressivox';
      cors['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      cors['Access-Control-Allow-Private-Network'] = 'true';
      cors['Access-Control-Max-Age'] = '600';
    }
    if (!hostOk(req.headers.host, port)) return send(res, 403, { ok: false, error: 'wrong-host' });   // blocks "DNS rebinding" tricks
    if (origin !== undefined && !originOk(origin)) return send(res, 403, { ok: false, error: 'origin-not-allowed' });
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, 'http://x');
    // the pairing page: opened by you in a browser tab. It carries no CORS headers, so other web pages cannot read it.
    if (req.method === 'GET' && url.pathname === '/' && origin === undefined) {
      return send(res, 200, `<!doctype html><meta charset=utf-8><title>XpressiVox helper</title><body style="font:16px system-ui;max-width:34em;margin:3em auto"><h2>XpressiVox helper is running</h2><p>Your pairing code is:</p><p style="font:600 22px ui-monospace,monospace;letter-spacing:1px">${token}</p><p>In XpressiVox, open the Preview setting "How the Preview talks to Synth V", choose "Use the XpressiVox helper" and paste this code. The code stays on this computer.</p>`);
    }
    if (req.headers['x-xpressivox-token'] !== token) return send(res, 401, { ok: false, error: 'bad-code' }, cors);
    if (req.method === 'GET' && url.pathname === '/status') {
      const hb = readJson(path.join(bridge, 'heartbeat.json'));
      const st = readJson(path.join(bridge, 'status.json'));
      const age = hb && typeof hb.lastBeatEpochMs === 'number' ? now() - hb.lastBeatEpochMs : null;
      return send(res, 200, { ok: true, helperVersion: HELPER_VERSION, secure, bridge, scriptRunning: age !== null && age < 4000, heartbeatAgeMs: age, scriptVersion: hb && hb.scriptVersion || null, heartbeat: hb, status: st }, cors);
    }
    if (req.method === 'POST' && (url.pathname === '/preview' || url.pathname === '/command')) {
      const chunks = []; let size = 0, dead = false;
      req.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { dead = true; send(res, 413, { ok: false, error: 'too-big' }, cors); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (dead) return;
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          if (url.pathname === '/preview') {
            const pv = JSON.parse(text);
            if (!pv || pv.format !== 'xvpreview') return send(res, 400, { ok: false, error: 'not-a-preview' }, cors);
            writeAtomic(path.join(bridge, 'XpressiVox_preview.xvpreview'), text);
            return send(res, 200, { ok: true, bytes: Buffer.byteLength(text) }, cors);
          }
          const b = JSON.parse(text);
          if (!b || !['play', 'pause', 'stop', 'replay'].includes(b.cmd)) return send(res, 400, { ok: false, error: 'unknown-command' }, cors);
          const cmd = { format: 'xvcmd', version: 1, cmd: b.cmd, createdAt: now(), createdBy: 'helper' };
          if (typeof b.fromBar === 'number' && b.fromBar >= 0) cmd.fromBar = b.fromBar;
          writeAtomic(path.join(bridge, 'XpressiVox_command.xvcmd'), JSON.stringify(cmd));
          return send(res, 200, { ok: true }, cors);
        } catch (e) { return send(res, 400, { ok: false, error: 'bad-json' }, cors); }
      });
      return;
    }
    send(res, 404, { ok: false, error: 'not-found' }, cors);
  };
  const server = secure ? https.createServer(tlsOpts, handler) : http.createServer(handler);
  return { server, token, bridge, tokenFile, secure };
}

module.exports = { HELPER_VERSION, rootFolder, makeServer };

// Runs on its own unless a test or another program loads it as a library (set XV_AS_LIBRARY=1).
if (process.env.XV_AS_LIBRARY !== '1') {
  const arg = process.argv.find((a) => a === '--version' || a === '--code');
  if (arg === '--version') { console.log('XpressiVox helper version ' + HELPER_VERSION); process.exit(0); }
  const { server, token, secure } = makeServer({ root: rootFolder() });
  if (arg === '--code') { console.log(token); process.exit(0); }
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. The helper may already be running.` : String(e)); process.exit(1); });
  server.listen(PORT, '127.0.0.1', () => console.log(`XpressiVox helper ${HELPER_VERSION} listening on 127.0.0.1:${PORT} (${secure ? 'https' : 'http'}). Open ${secure ? 'https' : 'http'}://127.0.0.1:${PORT}/ in a browser tab to see your pairing code.`));
}
