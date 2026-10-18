// Manual functional smoke with the real exported b18 model. No timing benchmark.
// Build first with public/models populated; this test is deliberately not in CI.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';

const mode = process.argv[2] ?? 'wasm-threads';
const isolated = mode !== 'wasm-single' && mode !== 'service-worker';
const root = resolve('dist');
const artifacts = resolve('../../.yagoo-data/browser-smoke', mode);
await mkdir(artifacts, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith('/yagoo-engine/')) { response.writeHead(404).end(); return; }
    const file = resolve(root, path.slice('/yagoo-engine/'.length) || 'index.html');
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const data = await readFile(file);
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    if (isolated) {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    response.writeHead(200).end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const logs = [];
const targets = new Map();
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
  const cdp = await browser.newBrowserCDPSession();
  cdp.on('Target.targetCreated', ({ targetInfo }) => targets.set(targetInfo.targetId, targetInfo));
  cdp.on('Target.targetInfoChanged', ({ targetInfo }) => targets.set(targetInfo.targetId, targetInfo));
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', message => { logs.push(message.type() + ': ' + message.text()); });
  page.on('pageerror', error => logs.push('PAGE ERROR: ' + error));
  page.on('requestfailed', request => logs.push('FETCH ERROR: ' + request.url() + ' ' + request.failure()?.errorText));
  await page.goto(`http://127.0.0.1:${server.address().port}/yagoo-engine/`);
  if (mode === 'service-worker') {
    await page.getByRole('button', { name: 'Enable threads on static hosting' }).click();
    await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 30_000 });
  }
  const capabilities = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return { isolated: crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer === 'function', cores: navigator.hardwareConcurrency,
      gpu: adapter ? { features: [...adapter.features], info: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } } : null };
  });
  console.log(JSON.stringify({ mode, capabilities }));
  if (mode !== 'webgpu') await page.locator('#wasm').check();
  await page.locator('#threads').fill('4');
  await page.getByRole('button', { name: 'Load and validate model' }).click();
  // Generous liveness bound; no recorded duration or throughput requirement.
  await page.waitForFunction(() => !document.querySelector('#scan').disabled || /failed:|Error:/.test(document.querySelector('#status').textContent), null, { timeout: 300_000 });
  const status = await page.locator('#status').innerText();
  console.log(status);
  await writeFile(resolve(artifacts, 'initialization.json'), JSON.stringify({ mode, capabilities, status }, null, 2));
  assert.equal(await page.locator('#scan').isEnabled(), true, status);
  if (mode === 'webgpu') assert.match(status, /^webgpu /, 'A Wasm fallback does not pass the WebGPU smoke');
  const ortWorkers = [...targets.values()].filter(t => t.type === 'worker' && /ort-wasm.*\.mjs/.test(t.url));
  if (mode === 'wasm-threads' || mode === 'service-worker') {
    assert.equal(capabilities.isolated, true);
    assert.match(status, /ORT 4 thread\(s\)/);
    assert.equal(ortWorkers.length, 3, 'Four ORT threads require the calling worker plus three pthread workers');
  } else if (mode === 'wasm-single') {
    assert.equal(capabilities.isolated, false);
    assert.match(status, /ORT 1 thread\(s\)/);
    assert.match(status, /cross-origin isolation/);
    assert.equal(ortWorkers.length, 0);
  }
  await page.getByRole('button', { name: 'Scan only', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('"type":"gameCompleted"') || /Error:/.test(document.querySelector('#status').textContent), null, { timeout: 300_000 });
  assert.match(await page.locator('#events').innerText(), /"type":"gameCompleted"/, await page.locator('#status').innerText());
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download events' }).click();
  await (await downloaded).saveAs(resolve(artifacts, 'events.ndjson'));
  const events = (await readFile(resolve(artifacts, 'events.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  const positions = events.filter(e => e.type === 'positionCompleted');
  assert.equal(positions.length, 3);
  for (const { snapshot } of positions) {
    assert.equal(snapshot.root.ownership.length, 81);
    assert.equal(snapshot.root.policy.length, 82);
    assert.ok(snapshot.root.ownership.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
    assert.ok(Math.abs(snapshot.root.policy.reduce((a, b) => a + b, 0) - 1) < 1e-6);
    assert.ok(snapshot.root.winrate >= 0 && snapshot.root.winrate <= 1);
    assert.ok(Number.isFinite(snapshot.root.scoreLead));
  }
  await page.screenshot({ path: resolve(artifacts, 'page.png'), fullPage: true });
  await writeFile(resolve(artifacts, 'result.json'), JSON.stringify({ mode, capabilities, status, ortWorkers, eventCount: events.length, positions: positions.length }, null, 2));
  if (mode === 'webgpu') {
    await page.locator('#sgf').fill('(;SZ[9]KM[7.5]RU[Chinese];B[cc])');
    await page.locator('#visits').fill('4');
    await page.locator('#all').check();
    await page.getByRole('button', { name: 'Scan and deepen', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#events').textContent.includes('"type":"gameCompleted"') || /failed|not implemented|Error:/.test(document.querySelector('#status').textContent), null, { timeout: 300_000 });
    assert.match(await page.locator('#events').innerText(), /"type":"gameCompleted"/, await page.locator('#status').innerText());
    const deepDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download events' }).click();
    await (await deepDownload).saveAs(resolve(artifacts, 'deep-events.ndjson'));
    const deepEvents = (await readFile(resolve(artifacts, 'deep-events.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(deepEvents.filter(e => e.type === 'stageCompleted' && e.phase === 'deep' && e.stage === 'root').length, 2);
    assert.equal(deepEvents.filter(e => e.type === 'stageCompleted' && e.phase === 'deep' && e.stage === 'pass_probe' && !e.skipped).length, 2);
    const roots = deepEvents.filter(e => e.type === 'positionCompleted' && e.phase === 'deep');
    for (const { snapshot } of roots) {
      assert.equal(snapshot.root.visits, 4);
      assert.ok(snapshot.candidates.length > 0);
      assert.ok(snapshot.candidates.every(c => c.pv.length > 0));
    }
    await page.locator('#sgf').fill('(;SZ[9]KM[6.5]RU[Japanese];B[];W[])');
    await page.getByRole('button', { name: 'Scan only', exact: true }).click();
    await page.waitForFunction(() => /Terminal scoring|encore/.test(document.querySelector('#status').textContent), null, { timeout: 300_000 });
    assert.doesNotMatch(await page.locator('#events').innerText(), /"type":"gameCompleted"/);
    await writeFile(resolve(artifacts, 'terminal-error.txt'), await page.locator('#status').innerText());
  }
  await page.getByRole('button', { name: 'Stop / release engine' }).click();
  assert.equal(await page.locator('#scan').isEnabled(), false);
  console.log(JSON.stringify({ result: 'passed', mode, ortPthreadWorkers: ortWorkers.length, events: events.length, positions: positions.length, artifacts }));
} catch (error) {
  console.error(error);
  await writeFile(resolve(artifacts, 'failure.txt'), String(error));
  process.exitCode = 1;
} finally {
  await writeFile(resolve(artifacts, 'console.log'), logs.join('\n'));
  await writeFile(resolve(artifacts, 'targets.json'), JSON.stringify([...targets.values()], null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
