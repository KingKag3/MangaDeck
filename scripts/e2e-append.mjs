// End to end: make a "complete" .cbz that stops one chapter short, let the series page save the missing chapter as a
// "New chapters" file, then merge it into the complete file with the folder panel. Real Suwayomi, real pages, the real
// app code, in headless Chrome. The folder is the browser's private file system (OPFS) standing in for the pickers,
// so nothing is written to your disks and the throwaway Chrome profile is deleted at the end.
//
//   npm run dev                       (the script imports app modules, so it needs the dev server, not the Docker build)
//   MANGA_ID=5041 node scripts/e2e-append.mjs
//
// Pick a small series whose chapters are already downloaded in Suwayomi (no source is contacted then). It only reads.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = (process.env.E2E_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const MANGA_ID = Number(process.env.MANGA_ID ?? 5041);
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Chrome or Edge not found. Set CHROME_PATH.');
try {
  if (!(await fetch(ORIGIN + '/src/main.tsx')).ok) throw new Error('not the dev server');
} catch (e) {
  console.error(`Cannot reach the dev server at ${ORIGIN} (${e.message}). Run npm run dev first.`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => {
  chrome.kill();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 800);
};

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
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
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
async function waitFor(expr, ms = 20000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try {
      v = await evalJs(expr);
    } catch {
      v = undefined;
    }
    if (v) return v;
    await sleep(300);
  }
  return v;
}
const clickText = (text, sel = 'button') =>
  evalJs(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}) && !x.disabled); if(!b) return false; b.click(); return true; })()`);

let failed = false;
const step = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed = true;
  return ok;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // The two pickers answer with a folder inside the browser's private file system.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('e2e', { create: true });
      window.showDirectoryPicker = async () => dir();
      window.showSaveFilePicker = async (o) => (await dir()).getFileHandle(o.suggestedName, { create: true });
    `,
  });
  await send('Page.navigate', { url: ORIGIN + '/' });
  await sleep(1500);

  // Series facts straight from the server.
  const info = await evalJs(`(async () => {
    const { Q } = await import('/src/api/queries.ts');
    const m = await Q.manga(${MANGA_ID});
    const ch = await Q.chapters(${MANGA_ID});
    return { title: m.title, nums: ch.map(c => c.chapterNumber).sort((a,b)=>a-b), notDownloaded: ch.filter(c=>!c.isDownloaded).length };
  })()`);
  const nums = info.nums.filter((n) => n >= 0);
  const last = nums[nums.length - 1];
  const before = nums[nums.length - 2];
  step(nums.length >= 3, `${info.title}: ${nums.length} chapters (1 to ${last}), ${info.notDownloaded} not yet downloaded on the server`);
  if (info.notDownloaded) console.log('note: undownloaded chapters make the export contact the source; pick a fully downloaded series to avoid that.');

  // Volumes: first half is volume 1, the rest volume 2, so the files look like a real series.
  const split = nums[Math.floor(nums.length / 2) - 1];
  await evalJs(`(() => {
    const s = JSON.parse(localStorage.getItem('mangadeck.settings') || '{}');
    s.volumes = { ...(s.volumes||{}), ${MANGA_ID}: { source: 'manual', page: '', savedAt: Date.now(), ranges: [{ volume: 1, first: ${nums[0]}, last: ${split} }, { volume: 2, first: ${split + 1}, last: ${last} }] } };
    localStorage.setItem('mangadeck.settings', JSON.stringify(s));
    return true; })()`);

  // 1. The complete file, one chapter short, made with the app's own packer and saved into the folder.
  const baseName = `${info.title} - Complete.cbz`;
  const base = await evalJs(`(async () => {
    const { Q } = await import('/src/api/queries.ts');
    const { buildCbz } = await import('/src/lib/export.ts');
    const { seriesChapters } = await import('/src/lib/volumes.ts');
    const all = (await Q.chapters(${MANGA_ID})).filter(c => c.chapterNumber <= ${before});
    const items = seriesChapters(all, [{ volume: 1, first: ${nums[0]}, last: ${split} }, { volume: 2, first: ${split + 1}, last: ${last} }]);
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e', { create: true });
    const w = await (await dir.getFileHandle(${JSON.stringify(baseName)}, { create: true })).createWritable();
    const r = await buildCbz({ series: ${JSON.stringify(info.title)}, items, sink: (p) => w.write(p) });
    await w.close();
    return { chapters: items.length, pages: r.pages };
  })()`);
  step(base.chapters === nums.length - 1, `complete file written: ${base.chapters} chapters, ${base.pages} pages (stops at chapter ${before})`);

  // 2. History says so, the series page offers the new chapters, and the click saves them as their own file.
  await evalJs(`localStorage.setItem('mangadeck.history', JSON.stringify([{ at: Date.now(), kind: 'series', mangaId: ${MANGA_ID}, title: ${JSON.stringify(info.title)}, label: 'Complete series .cbz', ok: true, lastChapter: ${before}, chapterCount: ${base.chapters} }])); true`);
  await send('Page.navigate', { url: `${ORIGIN}/manga/${MANGA_ID}` });
  const offered = await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Save the new chapters'))`);
  step(offered, `series page offers "Save the new chapters as .cbz" (series is at chapter ${last}, file ends at ${before})`);
  await clickText('Save the new chapters');
  const done = await waitFor(`(() => { const j = JSON.parse(localStorage.getItem('mangadeck.exportjobs')||'[]'); return j.length && j.every(x => x.state === 'done'); })()`, 60000);
  step(done, 'export job finished');
  const files1 = await evalJs(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e'); const n=[]; for await (const k of d.keys()) n.push(k); return n.sort(); })()`);
  const tailName = files1.find((f) => /new chapters/i.test(f));
  step(!!tailName, `folder now holds: ${files1.join(' | ')}`);

  const sizeOf = `(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e'); const o = {}; for await (const k of d.keys()) o[k] = (await (await d.getFileHandle(k)).getFile()).size; return o; })()`;
  const sizesBefore = await evalJs(sizeOf);

  // 3. The folder panel finds the new file and merges it into the complete one.
  await send('Page.navigate', { url: `${ORIGIN}/manga/${MANGA_ID}` });
  await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Choose folder'))`);
  await clickText('Choose folder');
  const hint = await waitFor(`(document.querySelector('.update-hint')||{}).textContent`, 20000);
  step(!!hint && /New chapters/i.test(hint), `panel says: ${hint ?? '(nothing)'}`);
  await clickText('Add to it');
  await waitFor(`!![...document.querySelectorAll('button')].find(b => /^Merge \\d+ files/.test(b.textContent))`);
  await clickText('Merge 2 files');
  const saved = await waitFor(`(document.body.textContent.match(/Saved .*?were not changed\\./)||[])[0]`, 60000);
  step(!!saved, `merge result: ${saved ?? '(no result)'}`);

  // 4. Read the merged file back: every chapter once, in order, and the originals untouched.
  const out = await evalJs(`(async () => {
    const { readZip } = await import('/src/lib/zipRead.ts');
    const { chapterKeyOf } = await import('/src/lib/merge.ts');
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e');
    const names = []; for await (const k of d.keys()) names.push(k);
    const mergedName = names.find(n => /Vols?\\./.test(n) && !/Complete|New chapters/.test(n));
    if (!mergedName) return { names };
    const entries = await readZip(await (await d.getFileHandle(mergedName)).getFile());
    const keys = entries.map(e => chapterKeyOf(e.name)).filter(Boolean);
    const sizes = {}; for (const n of names) sizes[n] = (await (await d.getFileHandle(n)).getFile()).size;
    return { names, mergedName, order: [...new Set(keys)], pages: keys.length, sizes };
  })()`);
  step(!!out.mergedName, `merged file: ${out.mergedName ?? 'missing'} (${out.names.join(' | ')})`);
  const sizesAfter = await evalJs(sizeOf);
  step(Object.entries(sizesBefore).every(([k, v]) => sizesAfter[k] === v), 'the complete file and the new-chapters file were not changed by the merge');
  if (out.order) {
    const want = nums.map((n) => 'c' + String(Math.floor(n)).padStart(4, '0'));
    step(JSON.stringify(out.order) === JSON.stringify(want), `chapters in the merged file: ${out.order.join(' ')}`);
    step(out.pages > base.pages, `pages: ${out.pages} (complete file had ${base.pages})`);
  }
  if (errors.length) step(false, 'script errors: ' + errors.slice(0, 2).join(' | ').slice(0, 300));
} catch (e) {
  step(false, e.message);
} finally {
  cleanup();
}
console.log(failed ? '\nFAILED' : '\nAll steps passed');
process.exit(failed ? 1 : 0);
