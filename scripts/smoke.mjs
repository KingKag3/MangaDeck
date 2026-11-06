// Smoke test: opens the main pages in headless Chrome against a RUNNING Mangadeck + Suwayomi and checks they render
// without script errors. No dependencies (Node 22+ for the global WebSocket, plus Chrome or Edge). It only reads: nothing
// is downloaded, saved or marked read, unless you add --reader (opens the first chapter, which saves a reading position).
//
//   npm run smoke                                 against http://localhost:8080 (the Docker build)
//   SMOKE_URL=http://localhost:5173 npm run smoke against the dev server
//   npm run smoke -- --reader                     also open the reader on the first chapter of the first title
//
// Exit code 1 when a check fails, so it can sit in a script or CI.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = (process.env.SMOKE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const READER = process.argv.includes('--reader');
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Chrome or Edge not found. Set CHROME_PATH.');

try {
  const r = await fetch(ORIGIN + '/');
  if (!r.ok) throw new Error(String(r.status));
} catch (e) {
  console.error(`Cannot reach ${ORIGIN} (${e.message}). Start Mangadeck first, or set SMOKE_URL.`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'smoke-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
let errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (!/Failed to load resource/.test(text)) errors.push('console.error: ' + text);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (msg) => (msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
};
/** Polls a page expression until it is truthy (or the time is up) and returns its last value. */
async function waitFor(expr, ms = 15000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try {
      v = await evalJs(expr);
    } catch {
      v = undefined;
    }
    if (v) return v;
    await sleep(250);
  }
  return v;
}
const go = async (path, width = 1280) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: ORIGIN + path });
  await sleep(600);
};

await send('Page.enable');
await send('Runtime.enable');

let failed = 0;
async function check(name, fn) {
  errors = [];
  const t0 = Date.now();
  let problem = '';
  try {
    problem = (await fn()) || '';
  } catch (e) {
    problem = e.message;
  }
  if (!problem && errors.length) problem = 'script errors: ' + errors.slice(0, 2).join(' | ').slice(0, 300);
  if (problem) failed++;
  console.log(`${problem ? 'FAIL' : 'ok  '} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${problem ? '\n       ' + problem : ''}`);
}
const text = 'document.body.innerText';

let firstId = null;
await check('library renders sections and cards', async () => {
  await go('/');
  const cards = await waitFor("document.querySelectorAll('.grid .card').length || 0");
  if (!cards) return 'no library cards (is the library empty or Suwayomi down?)';
  const t = await evalJs(text);
  if (!/Your library/.test(t)) return 'missing the "Your library" heading';
  firstId = await evalJs("document.querySelector('.grid .card')?.getAttribute('href')?.match(/manga\\/(\\d+)/)?.[1] ?? null");
});

await check('library applies a saved sort (latest chapter) and still lists every title', async () => {
  const total = await evalJs("document.querySelectorAll('.grid .card').length");
  await evalJs(`localStorage.setItem('mangadeck.libview', JSON.stringify({ sort: 'updated', desc: false, unreadOnly: false, downloadedOnly: false }))`);
  await go('/');
  const n = await waitFor("document.querySelectorAll('.grid .card').length || 0");
  const picked = await evalJs("document.querySelector('select[aria-label=\"Sort by\"]')?.value");
  await evalJs(`localStorage.removeItem('mangadeck.libview')`);
  if (picked !== 'updated') return `sort select shows "${picked}", expected "updated"`;
  if (n !== total) return `${n} cards after sorting, ${total} before`;
});

await check('library has no sideways scroll on a phone', async () => {
  await go('/', 390);
  await waitFor("document.querySelectorAll('.grid .card').length");
  const over = await evalJs('document.documentElement.scrollWidth - window.innerWidth');
  if (over > 1) return `page is ${over}px wider than a 390px screen`;
});

if (firstId) {
  await check(`manga page ${firstId} shows chapters`, async () => {
    await go(`/manga/${firstId}`);
    const ok = await waitFor("/chapters/i.test(document.body.innerText) && document.querySelectorAll('.chapter-row, .chapter, [class*=chapter]').length > 0");
    if (!ok) return 'no chapter list';
  });
}

await check('find page searches several sources', async () => {
  await go('/find?q=one%20piece');
  const n = await waitFor("document.querySelectorAll('h2, h3').length > 1 && document.querySelectorAll('h2, h3').length", 30000);
  if (!n) return 'no source sections appeared';
});

for (const [name, path, expect] of [
  ['updates page', '/updates', /Updates/],
  ['downloads page', '/downloads', /Downloads/],
  ['browse page', '/browse', /Sources|Extensions/],
  ['settings page with backup', '/settings', /Backup/],
]) {
  await check(name, async () => {
    await go(path);
    const ok = await waitFor(`(${expect}).test(document.body.innerText)`);
    if (!ok) return `expected text ${expect} not found`;
  });
}

if (READER && firstId) {
  await check('reader opens the first chapter (saves a reading position)', async () => {
    await go(`/manga/${firstId}`);
    const href = await waitFor("[...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).find((h) => h && h.startsWith('/read/'))");
    if (!href) return 'no chapter link to open';
    await go(href);
    const ok = await waitFor("[...document.images].some((i) => i.complete && i.naturalWidth > 0)", 30000);
    if (!ok) return 'no page image loaded';
  });
}

ws.close();
chrome.kill();
await sleep(300);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* Chrome may still hold files; the temp folder is harmless */
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
