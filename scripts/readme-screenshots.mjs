// Retakes the README screenshots (docs/screenshots) from the running DEV server with headless Chrome over the DevTools
// protocol. No dependencies: it needs Node 22+ (global WebSocket) and Chrome or Edge.
//
//   npm run dev                         (Suwayomi must be running; the pages are filled with pretend jobs, history and files)
//   npm run screenshots                 retake all
//   npm run screenshots -- downloads    retake only the named ones: downloads, manga-volumes-and-files, merge-dialog,
//                                       library-new-chapters, library-shelves
//
// Manga covers are hidden on purpose (public repo). The pages use manga ids from the maintainer's library (79 One-Punch Man,
// which needs a saved volume list, plus a few others only for links); set MANGA_ID if yours differs. The pretend folder
// for the "Your .cbz files" panel is built in the page (it imports /src/lib/zip.ts, so this only works against `npm run dev`).
// Env: SCREENSHOT_URL (default http://localhost:5173), CHROME_PATH.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.SCREENSHOT_URL ?? 'http://localhost:5173';
const MANGA_ID = process.env.MANGA_ID ?? '79';
const OUT = 'docs/screenshots';
const ONLY = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json')).json();
      const page = list.find((t) => t.type === 'page');
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
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
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
const go = async (url) => {
  await send('Page.navigate', { url });
  await sleep(2500);
};

await send('Page.enable');

const HIDE = `(() => { const s = document.createElement('style'); s.textContent = '.cover img,.rec-link img,.history-cover img,.thumb img,.hero-bg{visibility:hidden}'; document.head.appendChild(s); })()`;

async function shot(name, { path, width = 1280, setup, after, clipSel, rangeSel, height, minHeight = 700, scale = 1.5 }) {
  if (ONLY.length && !ONLY.includes(name)) return;
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: scale, mobile: false });
  await go(ORIGIN + '/');
  if (setup) await evalJs(setup);
  await go(ORIGIN + path);
  await sleep(2500);
  await evalJs(HIDE);
  if (after) await evalJs(after);
  await sleep(700);
  let clip;
  if (clipSel) {
    const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(clipSel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, b.top + scrollY - 24), w: ${width}, h: b.height + 48 }; })()`);
    if (!r) throw new Error(name + ': nothing matches ' + clipSel);
    clip = r;
  }
  if (rangeSel) {
    // From the top of the first element to the bottom of the second.
    const r = await evalJs(`(() => { const a = document.querySelector(${JSON.stringify(rangeSel[0])}), b = document.querySelector(${JSON.stringify(rangeSel[1])}); if (!a || !b) return null; const ta = a.getBoundingClientRect().top + scrollY - 150, bb = b.getBoundingClientRect().bottom + scrollY + 24; return { x: 0, y: Math.max(0, ta), w: ${width}, h: bb - ta }; })()`);
    if (!r) throw new Error(name + ': range elements missing');
    clip = r;
  }
  const docH = height ?? (await evalJs('document.documentElement.scrollHeight'));
  const h = height ?? Math.max(minHeight, clip ? clip.y + clip.h : docH);
  await send('Emulation.setDeviceMetricsOverride', { width, height: Math.ceil(h), deviceScaleFactor: scale, mobile: false });
  await sleep(500);
  const params = { format: 'jpeg', quality: 84 };
  if (clip) params.clip = { x: 0, y: clip.y, width, height: clip.h, scale: 1 };
  const { data } = await send('Page.captureScreenshot', params);
  writeFileSync(join(OUT, name + '.jpg'), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

const downloadsSetup = `(() => {
  const now = Date.now();
  const mk = (n, base) => Array.from({ length: n }, (_, i) => ({ id: base + i, chapterNumber: i + 1, volume: null, label: 'Chapter ' + (i + 1) }));
  const mp = mk(101, 910000), gto = mk(9, 920000);
  const jobs = [
    { id: 'ex1', mangaId: 73, title: 'Mob Psycho 100', volume: 0, fileName: 'Mob Psycho 100 - Complete.cbz', items: mp, meta: {}, todo: mp.slice(61).map((i) => i.id), parked: [], round: 1, phase: 'downloading', state: 'paused', done: 61, packed: 0, failStreak: 0, createdAt: now - 3600e3, note: 'Paused' },
    { id: 'ex2', mangaId: 4889, title: 'GTO: Great Teacher Onizuka', volume: 3, fileName: 'GTO - Vol. 03.cbz', items: gto, meta: {}, todo: [], parked: [gto[2].id, gto[5].id], round: 2, phase: 'downloading', state: 'paused', done: 7, packed: 0, failStreak: 0, createdAt: now - 7200e3, note: '2 chapters could not be downloaded after retrying. Retry them, or write the file without them.' },
    { id: 'ex3', mangaId: 38, title: 'Omniscient Reader', volume: 1, fileName: 'Omniscient Reader - Vol. 01.cbz', items: mk(10, 930000), meta: {}, todo: [], parked: [], round: 1, phase: 'packing', state: 'done', done: 10, packed: 10, failStreak: 0, createdAt: now - 9000e3 },
  ];
  localStorage.setItem('mangadeck.exportjobs', JSON.stringify(jobs));
  localStorage.setItem('mangadeck.pacejobs', JSON.stringify([{ id: 'pj1', title: 'Dandadan', mangaId: 79, queue: Array.from({ length: 83 }, (_, i) => 940000 + i), total: 120, done: 37, failed: 1, state: 'paused', note: 'Paused: the source failed 3 times in a row. Resume to try again.', failStreak: 3, createdAt: now - 5000e3 }]));
  const h = (mins, kind, mangaId, title, label, note, where) => ({ at: now - mins * 60e3, kind, mangaId, title, label, ok: true, note, where });
  localStorage.setItem('mangadeck.history', JSON.stringify([
    h(12, 'volume', 79, 'One-Punch Man', 'Vol. 12 .cbz', '10 chapters, 214 pages', 'One-Punch Man - Vol. 12.cbz in the folder \\u201cManga\\u201d you picked'),
    h(25, 'volume', 79, 'One-Punch Man', 'Vol. 11 .cbz', '9 chapters, 198 pages', 'One-Punch Man - Vol. 11.cbz in the folder \\u201cManga\\u201d you picked'),
    h(95, 'chapter', 65, 'Chainsaw Man', 'Chapter 213'),
    h(300, 'series', 4889, 'GTO: Great Teacher Onizuka', 'Complete series .cbz', '200 chapters, 4210 pages. Left out: Chapter 90', 'GTO - Complete.cbz (where you chose to save it)'),
    h(1500, 'chapter', 36, 'Dandadan', 'Chapter 190', 'from Atsumaru (this source failed)'),
  ]));
})()`;

/** A pretend folder with three volume files, so the "Your .cbz files" panel has something to show. */
const folderMock = `(async () => {
  const { ZipBuilder } = await import('/src/lib/zip.ts');
  const title = document.querySelector('h1')?.innerText || 'Series';
  const mk = async (name, vol, n) => { const z = new ZipBuilder(); for (let i = 1; i <= n; i++) await z.add(i + '.jpg', new TextEncoder().encode('p' + vol + '_' + i + 'x'.repeat(4000))); await z.add('ComicInfo.xml', new TextEncoder().encode('<ComicInfo><Series>' + title + '</Series><Volume>' + vol + '</Volume></ComicInfo>')); return new File([await z.finish()], name); };
  const store = new Map();
  for (const v of [1, 2, 3, 5]) { const nm = title + ' - Vol. ' + String(v).padStart(2, '0') + '.cbz'; store.set(nm, await mk(nm, v, 6)); }
  const dir = { name: 'Manga', async *values() { for (const [name, f] of store) yield { kind: 'file', name, getFile: async () => f }; },
    async getFileHandle(name, o) { if (!store.has(name) && !o?.create) throw new Error('nf'); return { async getFile() { return store.get(name) ?? new File([], name); }, async createWritable() { const parts = []; return { async write(d) { parts.push(d); }, async close() { store.set(name, new File(parts, name)); }, async abort() {} }; } }; },
    async removeEntry() {}, queryPermission: async () => 'granted', requestPermission: async () => 'granted' };
  window.showDirectoryPicker = async () => dir;
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Choose folder'))?.click();
  await new Promise((r) => setTimeout(r, 1200));
})()`;

await shot('downloads-page', { path: '/downloads', width: 1000, setup: downloadsSetup, scale: 1.6 });
await shot('manga-volumes-and-files', { path: `/manga/${MANGA_ID}`, width: 1100, after: folderMock, rangeSel: ['.local-files', '.volume-bar'], scale: 1.6 });
await shot('merge-dialog', {
  path: `/manga/${MANGA_ID}`,
  width: 1100,
  after: folderMock + ".then(async () => { [...document.querySelectorAll('button')].find((b) => /^Merge \\d+ selected/.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 1500)); })",
  height: 880,
  scale: 1.6,
});
await shot('library-new-chapters', {
  path: '/',
  width: 1180,
  setup: "(() => { localStorage.setItem('mangadeck.fresh', JSON.stringify({ '2122': 3, '65': 1, '36': 2 })); })()",
  after: "(async () => { [...document.querySelectorAll('button')].find((b) => /Show only these/.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 600)); document.querySelectorAll('section.shelf').forEach((s) => (s.style.display = 'none')); })()",
  height: 520,
  scale: 1.6,
});
await shot('library-shelves', { path: '/', width: 1180, height: 1500, setup: "(() => { localStorage.removeItem('mangadeck.fresh'); })()", scale: 1.6 });

ws.close();
chrome.kill();
await sleep(800);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* Chrome may still hold the temp profile for a moment; the OS cleans the temp folder */
}
process.exit(0);
