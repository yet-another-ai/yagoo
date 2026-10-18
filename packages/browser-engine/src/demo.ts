import { BrowserEngine } from './client';
import { enableIsolation } from './isolation';
import './style.css';
const engine = new BrowserEngine();
const status = document.querySelector<HTMLElement>('#status')!;
const output = document.querySelector<HTMLElement>('#events')!;
const scan = document.querySelector<HTMLButtonElement>('#scan')!;
const deep = document.querySelector<HTMLButtonElement>('#deep')!;
const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
let events: string[] = [];
let analysisFailed = false;
let batchSummary = '';
engine.onMessage = message => {
  if (message.type === 'download') status.textContent = `Downloading verified model: ${Math.round(Number(message.loaded) / Number(message.total) * 100)}%`;
  if (message.type === 'error') status.textContent = String(message.message);
  if (message.type === 'event') {
    const line = JSON.stringify(message.event); events.push(line);
    output.textContent = events.slice(-5).join('\n');
    const event = message.event as { type: string; message?: string };
    if (event.type === 'error') { analysisFailed = true; status.textContent = event.message ?? 'Analysis failed.'; }
  }
  if (message.type === 'stats') batchSummary = ` Largest actual NN batch: ${message.maxBatch}; neural evaluations: ${message.evaluations}.`;
  if (message.type === 'done' && !analysisFailed) status.textContent = 'Analysis complete. Download the NDJSON events to open them in the reviewer.' + batchSummary;
};
document.querySelector('#load')!.addEventListener('click', async () => {
  scan.disabled = deep.disabled = true; status.textContent = 'Initializing…';
  try {
    const storage = await navigator.storage?.persist?.().catch(() => false);
    const result = await engine.initialize(input('manifest').value, { forceWasm: input('wasm').checked, wasmThreads: Number(input('threads').value) });
    status.textContent = `${result.backend} ${result.precision}; ORT ${result.ortThreads} thread(s), Rust search 1 on the same worker. Maximum neural batch: ${result.maxBatch}. SWA reference validated. Persistent cache: ${storage ? 'granted' : 'best effort'}. ${result.messages.join(' ')}`;
    scan.disabled = deep.disabled = false;
  } catch (error) { status.textContent = String(error); }
});
document.querySelector('#isolation')!.addEventListener('click', async () => {
  try { status.textContent = await enableIsolation(); } catch (error) { status.textContent = String(error); }
});
document.querySelector('#stop')!.addEventListener('click', () => { engine.dispose(); scan.disabled = deep.disabled = true; status.textContent = 'Stopped. Model memory and workers released.'; });
for (const [button, count] of [[scan, 0], [deep, 12]] as const) button.addEventListener('click', () => {
  try {
    const visits = Number(input('visits').value);
    if (!Number.isInteger(visits) || visits < 1 || visits > 10000) throw new Error('Visit budget must be an integer from 1 to 10000.');
    events = []; analysisFailed = false; batchSummary = ''; output.textContent = '';
    engine.analyze(document.querySelector<HTMLTextAreaElement>('#sgf')!.value, {
      rootVisits: visits, pvEndVisits: Math.min(visits, 100),
      deepenAll: count > 0 && input('all').checked, deepSelect: { maxDeepPlies: count },
    }, { rootSymmetries: input('symmetries').checked ? 8 : 1, batchSize: Number(input('batch').value) });
    status.textContent = 'Analyzing…';
  }
  catch (error) { status.textContent = String(error); }
});
document.querySelector('#download')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([events.join('\n') + '\n'], { type: 'application/x-ndjson' }));
  const a = document.createElement('a'); a.href = url; a.download = 'yagoo-events.ndjson'; a.click(); URL.revokeObjectURL(url);
});
