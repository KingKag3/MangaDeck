// Smoke test: opens the main pages in headless Chrome against a RUNNING Mangadeck + Suwayomi and checks they render
// without script errors. No dependencies (Node 22+ for the global WebSocket, plus Chrome or Edge). It only reads: nothing
// is downloaded, saved or marked read, unless you add --reader (opens the first chapter, which saves a reading position).
//
//   npm run smoke                                 against http://localhost:8080 (the Docker build)
//   SMOKE_URL=http://localhost:5173 npm run smoke against the dev server
//   npm run smoke -- --reader                     also open the reader on the first chapter of the first title
//   npm run smoke -- --offline                    also save one chapter for offline reading, cut the network, and read it
//                                                 (the chapter is fetched once through Suwayomi; it is stored only in the throwaway Chrome profile)
//
// Exit code 1 when a check fails, so it can sit in a script or CI.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = (process.env.SMOKE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const READER = process.argv.includes('--reader');
const OFFLINE = process.argv.includes('--offline');
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
  ['settings page with AniList tracking', '/settings', /AniList tracking/],
  ['offline library page', '/offline', /Offline library/],
]) {
  await check(name, async () => {
    await go(path);
    const ok = await waitFor(`(${expect}).test(document.body.innerText)`);
    if (!ok) return `expected text ${expect} not found`;
  });
}

await check('settings: typing an AniList client id enables Connect', async () => {
  await go('/settings');
  await waitFor("/AniList tracking/.test(document.body.innerText)");
  const btn = "[...document.querySelectorAll('button')].find((b) => /Connect AniList/.test(b.textContent))";
  if (!(await evalJs(btn + '?.disabled'))) return 'Connect should be disabled without a client id';
  await evalJs("[...document.querySelectorAll('label.field')].find((l) => /Client ID/.test(l.innerText)).querySelector('input').focus()");
  await send('Input.insertText', { text: '12345' });
  const enabled = await waitFor('!(' + btn + ').disabled');
  await evalJs("localStorage.removeItem('mangadeck.anilist')");
  if (!enabled) return 'Connect stayed disabled after typing a numeric client id';
});

if (firstId) {
  await check('AniList: progress that could not be sent is kept, retried, and a pull with nothing new changes nothing', async () => {
    // A pretend AniList: in "down" mode every request fails like a lost connection. Installed before the app loads,
    // so its own start-up retry cannot reach the real AniList with the made-up token.
    const hook = await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const real = window.fetch.bind(window);
        window.__al = { down: true, calls: [] };
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input.url;
          if (!/graphql\.anilist\.co/.test(url)) return real(input, init);
          const body = String(init && init.body || '');
          window.__al.calls.push(body);
          if (window.__al.down) return Promise.reject(new TypeError('Failed to fetch'));
          const data = body.includes('SaveMediaListEntry') ? { SaveMediaListEntry: { id: 1 } }
            : { Media: { chapters: null, mediaListEntry: { progress: body.includes('mediaListEntry{progress}') ? 0 : 0, status: 'CURRENT' } } };
          return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        };
      })();`,
    });
    try {
      await go('/');
      await evalJs(`localStorage.setItem('mangadeck.anilist', JSON.stringify({ clientId: '1', token: 'made-up', expiresAt: Date.now() + 86400000, name: 'tester' }));
        localStorage.setItem('mangadeck.tracker', JSON.stringify({ '${firstId}': { mediaId: 1, title: 'Test', total: null, url: 'https://anilist.co/manga/1' } }));
        localStorage.setItem('mangadeck.trackerQueue', JSON.stringify({ '${firstId}': 5 }))`);
      await go('/settings');
      const btn = "[...document.querySelectorAll('button')].find((b) => /Try now/.test(b.textContent))";
      if (!(await waitFor('!!' + btn))) return 'Settings does not show the waiting progress with a Try now button';
      await evalJs(btn + '.click()');
      if (!(await waitFor("/still cannot be reached/.test(document.body.innerText)"))) return 'no notice that AniList could not be reached';
      if (!(await evalJs("localStorage.getItem('mangadeck.trackerQueue')")).includes('5')) return 'the waiting progress was lost while AniList was down';
      await evalJs('window.__al.down = false; window.__al.calls = []');
      await evalJs(btn + '.click()');
      if (!(await waitFor("/Sent progress for 1 series/.test(document.body.innerText)"))) return 'retry did not report sending progress';
      const sent = await evalJs('window.__al.calls.some((c) => c.includes("SaveMediaListEntry") && /"p":5/.test(c))');
      if (!sent) return 'retry did not write chapter 5 to AniList';
      if ((await evalJs("localStorage.getItem('mangadeck.trackerQueue')")) !== '{}') return 'the queue was not emptied after sending';
      // Pulling when AniList has nothing ahead of what is read here must not mark anything.
      await go(`/manga/${firstId}`);
      await evalJs('window.__al.down = false'); // a new page starts with the pretend AniList down again
      const pull = "[...document.querySelectorAll('button')].find((b) => /Get progress from AniList/.test(b.textContent))";
      await evalJs("document.querySelector('details.tracker-panel > summary')?.click()");
      if (!(await waitFor('!!' + pull))) return 'manga page has no Get progress from AniList button';
      await evalJs(pull + '.click()');
      if (!(await waitFor("/Nothing to mark/.test(document.body.innerText)"))) return 'pull did not report that there was nothing to mark';
    } finally {
      await evalJs("['mangadeck.anilist','mangadeck.tracker','mangadeck.trackerQueue'].forEach((k) => localStorage.removeItem(k))").catch(() => undefined);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier });
    }
  });
}

await check('duplicates page renders', async () => {
  await go('/duplicates');
  const ok = await waitFor("/Duplicate series/.test(document.body.innerText) && /No duplicates found|Remove/.test(document.body.innerText)", 20000);
  if (!ok) return 'page did not finish loading';
});

await check('settings lists the groups in the library and can prefer one', async () => {
  await go('/settings');
  await waitFor("/Backup/.test(document.body.innerText)");
  await evalJs("[...document.querySelectorAll('button')].find((b) => /Show the groups/.test(b.textContent))?.click()");
  const rows = await waitFor("document.querySelectorAll('.group-list li').length", 30000);
  if (!rows) return 'no groups listed (library has no chapters, or the query failed)';
  const clicked = await evalJs("(() => { const b = [...document.querySelectorAll('.group-list .link-btn')][0]; if (!b) return false; b.click(); return true; })()");
  if (!clicked) return 'no group to prefer';
  const saved = await waitFor("JSON.parse(localStorage.getItem('mangadeck.settings') || '{}').defaultGroup");
  if (!saved) return 'preferred group was not saved';
});

if (firstId) {
  await check('manga page group bar (when the series has several groups)', async () => {
    await evalJs("localStorage.removeItem('mangadeck.settings')");
    await go('/manga/' + firstId);
    await waitFor("/chapters/i.test(document.body.innerText)");
    const chips = await evalJs("document.querySelectorAll('.group-chip').length");
    if (chips > 0) {
      const clickedOne = await evalJs("(() => { const c = [...document.querySelectorAll('.group-chip')][1]; if (!c) return false; c.click(); return true; })()");
      if (clickedOne) {
        const on = await waitFor("document.querySelectorAll('.group-chip.on').length === 1");
        if (!on) return 'choosing a group did not highlight it';
      }
    }
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

if (OFFLINE && firstId) {
  await check('offline: save a chapter, lose the server, still read it', async () => {
    await go(`/manga/${firstId}`);
    const row = await waitFor("document.querySelectorAll('.chapter .icon-btn[title^=\"Save for offline\"]').length");
    if (!row) return 'no chapter with a Save for offline button';
    await evalJs("document.querySelector('.chapter .icon-btn[title^=\"Save for offline\"]').click()");
    const saved = await waitFor("!!document.querySelector('.chapter .icon-btn.saved') || /could not be saved/.test(document.body.innerText)", 120000);
    if (!saved) return 'the chapter was not saved within 2 minutes. Page said: ' + (await evalJs("[...document.querySelectorAll('.offline-bar, .toast')].map((e) => e.innerText).join(' | ')"));
    const pages = await evalJs("caches.open('mangadeck-offline-pages').then((c) => c.keys()).then((k) => k.length)");
    if (!pages) return 'no page images in the offline cache';
    const href = await evalJs("document.querySelector('.chapter .icon-btn.saved').closest('li').querySelector('a[href^=\"/read/\"]').getAttribute('href')");
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await go(href);
      const shown = await waitFor('[...document.images].some((i) => i.complete && i.naturalWidth > 0)', 30000);
      if (!shown) return 'the saved chapter did not open offline';
      await go(`/manga/${firstId}`);
      const bar = await waitFor("/Can't reach the server/.test(document.body.innerText)", 20000);
      if (!bar) return 'no offline notice on the series page';
      await go('/');
      const lib = await waitFor("document.querySelectorAll('.grid .card').length", 20000);
      if (!lib) return 'the library did not open offline from the saved copy';
    } finally {
      await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
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
