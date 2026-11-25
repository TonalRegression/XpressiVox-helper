// Runs the page's helper code (cut out of the built page) against the real helper, with a stand-in page. node test-page-helper.mjs PAGE.html
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import vm from 'node:vm';
process.env.XV_AS_LIBRARY = '1';
import { createRequire } from 'node:module';
const { makeServer } = createRequire(import.meta.url)('./xpressivox-helper.cjs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const a = html.indexOf('// ---------------------------------------------------------------- b56: the optional helper'), b = html.indexOf('// ---------------------------------------------------------------- sending\nconst fingerprint');
if (a < 0 || b < 0) { console.log('FAIL: helper block not found'); process.exit(1); }
let bad = 0; const check = (c, l) => { if (!c) { bad++; console.log('  FAIL: ' + l); } else console.log('  ok: ' + l); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xvp-')); const { server, token, bridge } = makeServer({ root, port: 47321 });
await new Promise((r) => server.listen(47321, '127.0.0.1', r));
const ls = {}; const said = [], chips = []; const notes = { textContent: '', classList: { remove() {} } };
const rowKids = []; const ctx = { L: {}, location: { protocol: 'file:' }, fetch, localStorage: { getItem: (k) => ls[k] ?? null, setItem: (k, v) => { ls[k] = v; } }, document: { hidden: false },
  note: notes, setChip: (k, t) => chips.push(t), say: (t, k) => said.push(t), logit() {}, clock: () => 'now', fingerprint: () => 'fp', sendBtn: { disabled: true },
  row: { prepend: (x) => { rowKids.length = 0; rowKids.push(x); } }, transport: { remove() { rowKids.length = 0; } }, CMDS: { play: 'Play', stop: 'Stop' }, setInterval, clearInterval, setTimeout, Date, JSON, Object, Error, console };
vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + '\nthis.api = { setMode, helperStatus, helperSend, helperCommand, L, applyMode };', ctx);
const api = ctx.api;
api.setMode('helper', ''); await api.helperStatus(); check(chips.at(-1) === 'Helper: no code', 'no code -> chip says so');
api.setMode('helper', 'wrongwrongwrongwrongwron'); await api.helperStatus(); check(/not accepted/.test(notes.textContent), 'wrong code -> "not accepted"');
api.setMode('helper', token); await api.helperStatus(); check(api.L.helper.state === 'noscript' && chips.at(-1) === 'Helper on, script off', 'right code, no script -> script off');
fs.writeFileSync(path.join(bridge, 'heartbeat.json'), JSON.stringify({ lastBeatEpochMs: Date.now(), project: 'Salvation PLAYBACK.svp', projectIsPlayback: true }));
await api.helperStatus(); check(api.L.helper.state === 'ready' && /Salvation PLAYBACK/.test(notes.textContent) && chips.at(-1) === 'Helper connected', 'fresh heartbeat -> connected, project named');
check(rowKids.length === 1 && ls['xv.sendMode'] === 'helper' && ls['xv.helperCode'] === token, 'transport added; mode and code remembered');
const pv = { format: 'xvpreview', version: 1, tracks: [{ notes: [1, 2] }] };
api.L.sending = true; api.helperSend(JSON.stringify(pv), pv, { label: '1-4' }, Date.now(), 2); await new Promise((r) => setTimeout(r, 300));
check(fs.existsSync(path.join(bridge, 'XpressiVox_preview.xvpreview')) && /Sent to the helper/.test(said.at(-1)) && api.L.sending === false, 'Send writes the preview file in the bridge folder and frees the button');
api.helperCommand('play', Date.now()); await new Promise((r) => setTimeout(r, 300));
check(JSON.parse(fs.readFileSync(path.join(bridge, 'XpressiVox_command.xvcmd'), 'utf8')).cmd === 'play', 'Play writes a command file');
api.setMode('file', token); check(rowKids.length === 0 && chips.at(-1) !== undefined, 'back to file mode removes the transport buttons');
server.close(); api.L.poll && clearInterval(api.L.poll);
// helper down
ctx.fetch = () => Promise.reject(new TypeError('Load failed')); api.setMode('helper', token); await api.helperStatus(); check(api.L.helper.state === 'down' && /could not be reached/.test(notes.textContent), 'helper not running -> "could not be reached"');
api.setMode('file', ''); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
