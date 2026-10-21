import { BrowserEngine } from './client';
import { MODEL_CATALOG, defaultCatalogEntry, formatBytes, type CatalogEntry } from './catalog';
import { clearModelCache, listCachedModels } from './cache';
import { artifactsCached, bundleFromLocalFiles, manifestDownloadBytes, validateManifest } from './model';
import { SINGLE_THREAD_NOTE } from './capabilities';
import { enableIsolation } from './isolation';
import { configuredManifestUrl } from './manifest-url';
import './style.css';

const engine = new BrowserEngine();
const status = document.querySelector<HTMLElement>('#status')!;
const output = document.querySelector<HTMLElement>('#events')!;
const activationStatus = document.querySelector<HTMLElement>('#activation-status')!;
const scan = document.querySelector<HTMLButtonElement>('#scan')!;
const deep = document.querySelector<HTMLButtonElement>('#deep')!;
const loadBtn = document.querySelector<HTMLButtonElement>('#load')!;
const cancelBtn = document.querySelector<HTMLButtonElement>('#cancel-download')!;
const clearBtn = document.querySelector<HTMLButtonElement>('#clear-cache')!;
const modelSelect = document.querySelector<HTMLSelectElement>('#model-select')!;
const modelSize = document.querySelector<HTMLElement>('#model-size')!;
const modelNotes = document.querySelector<HTMLElement>('#model-notes')!;
const modelStatus = document.querySelector<HTMLElement>('#model-status')!;
const modelStatusWrap = document.querySelector<HTMLElement>('#model-status-wrap')!;
const downloadBar = document.querySelector<HTMLElement>('#download-bar')!;
const cacheStatus = document.querySelector<HTMLElement>('#cache-status')!;
const localFiles = document.querySelector<HTMLInputElement>('#local-files')!;
const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;

let events: string[] = [];
let analysisFailed = false;
let batchSummary = '';
let engineReady = false;
let analysisRunning = false;
let lifecycle = 0;
let loadingModel = false;
let localRevoke: (() => void) | undefined;
let selected: CatalogEntry = defaultCatalogEntry();

const updateAnalysisButtons = () => { scan.disabled = deep.disabled = !engineReady || analysisRunning; };
const setModelUi = (state: 'idle' | 'busy' | 'ready' | 'error', text: string, percent?: number) => {
  modelStatusWrap.classList.toggle('is-busy', state === 'busy');
  modelStatusWrap.classList.toggle('is-ready', state === 'ready');
  modelStatusWrap.classList.toggle('is-error', state === 'error');
  modelStatus.textContent = text;
  if (percent == null) {
    downloadBar.hidden = true;
  } else {
    downloadBar.hidden = false;
    downloadBar.style.setProperty('--p', String(Math.min(1, Math.max(0, percent / 100))));
  }
  cancelBtn.disabled = !loadingModel;
  loadBtn.disabled = loadingModel || Boolean(selected.disabled);
};

async function refreshCacheStatus(manifest?: ReturnType<typeof validateManifest>, preferFp16 = false): Promise<void> {
  try {
    const entries = await listCachedModels();
    const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let detail = entries.length
      ? `Cache: ${entries.length} artifact(s), ${formatBytes(total)}`
      : 'Cache: empty (OPFS)';
    if (manifest) {
      detail += (await artifactsCached(manifest, preferFp16)) ? ' · selected model cached' : ' · selected model not cached';
    }
    cacheStatus.textContent = detail;
  } catch {
    cacheStatus.textContent = 'Cache: unavailable';
  }
}

function fillCatalog(): void {
  modelSelect.replaceChildren();
  for (const entry of MODEL_CATALOG) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    option.disabled = entry.disabled === true;
    if (entry.default) option.selected = true;
    modelSelect.append(option);
  }
  applyCatalogSelection(defaultCatalogEntry());
}

function applyCatalogSelection(entry: CatalogEntry): void {
  selected = entry;
  modelNotes.textContent = entry.notes;
  modelSize.textContent = entry.approxBytes > 0
    ? `About ${formatBytes(entry.approxBytes)} (exact size after Load reads the manifest)`
    : 'Not available for download';
  if (entry.manifestUrl) input('manifest').value = entry.manifestUrl;
  setModelUi(engineReady ? 'ready' : 'idle', engineReady ? 'Model ready' : `${entry.name} · not loaded`);
  void refreshCacheStatus(undefined, entry.preferFp16 === true);
}

fillCatalog();
const remoteManifest = configuredManifestUrl();
const manifestField = document.querySelector<HTMLElement>('#manifest-field');
if (manifestField) manifestField.hidden = !remoteManifest;
if (!remoteManifest) input('manifest').value = '';
const isolationHint = document.querySelector<HTMLElement>('#isolation-hint');
if (isolationHint && !crossOriginIsolated) isolationHint.textContent = SINGLE_THREAD_NOTE;
// Page load: catalog + cache listing only. No manifest or weight download.
void refreshCacheStatus();

modelSelect.addEventListener('change', () => {
  const entry = MODEL_CATALOG.find(item => item.id === modelSelect.value) ?? defaultCatalogEntry();
  localRevoke?.(); localRevoke = undefined;
  applyCatalogSelection(entry);
});

engine.onMessage = message => {
  if (message.type === 'rootActivations') {
    const lease = message.lease as import('./activations').ActivationLease | undefined;
    activationStatus.dataset.lease = lease ? JSON.stringify(lease) : '';
    activationStatus.textContent = message.available
      ? `${lease!.layers.length} GPU root layers retained (${(lease!.layers.reduce((total, layer) => total + layer.bytes, 0) / 1048576).toFixed(1)} MiB), query ${lease!.queryId}, ${lease!.toPlay} to play, identity sample. Replaced at the next query root; not included in NDJSON.`
      : String(message.reason);
  }
  if (message.type === 'download') {
    const loaded = Number(message.loaded);
    const total = Number(message.total);
    const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
    setModelUi('busy', `Downloading ${formatBytes(loaded)} / ${formatBytes(total)}`, percent);
    status.textContent = `Downloading verified model: ${percent}%`;
  }
  if (message.type === 'error') status.textContent = String(message.message);
  if (message.type === 'event') {
    const line = JSON.stringify(message.event); events.push(line);
    output.textContent = events.slice(-5).join('\n');
    const event = message.event as { type: string; message?: string };
    if (event.type === 'error') { analysisFailed = true; status.textContent = event.message ?? 'Analysis failed.'; }
  }
  if (message.type === 'stats') batchSummary = ` Largest actual NN batch: ${message.maxBatch}; neural evaluations: ${message.evaluations}.`;
  if (message.type === 'done' && !analysisFailed) status.textContent = 'Analysis complete. Download the NDJSON events to open them in the reviewer.' + batchSummary;
  if (message.type === 'done' || message.type === 'error') { analysisRunning = false; updateAnalysisButtons(); }
};

async function loadModel(): Promise<void> {
  if (loadingModel || selected.disabled) return;
  const manifestUrl = input('manifest').value.trim();
  if (!manifestUrl) {
    setModelUi('idle', 'No model loaded');
    status.textContent = 'No remote manifest is configured. Load a local model bundle (manifest.json, the .onnx weights, and warmup.json).';
    return;
  }
  const request = ++lifecycle;
  loadingModel = true;
  engine.dispose();
  activationStatus.dataset.lease = '';
  activationStatus.textContent = 'Root activation handles expired; initializing a new engine.';
  engineReady = false; analysisRunning = false; updateAnalysisButtons();
  setModelUi('busy', 'Preparing model…', 0);
  status.textContent = 'Initializing…';
  try {
    const storage = await navigator.storage?.persist?.().catch(() => false);
    if (request !== lifecycle) return;
    const result = await engine.initialize(manifestUrl, {
      forceWasm: input('wasm').checked,
      wasmThreads: Number(input('threads').value),
      retainRootActivations: input('activations').checked,
    });
    if (request !== lifecycle) return;
    status.textContent = `${result.backend} ${result.precision}; ORT ${result.ortThreads} thread(s), Rust search 1 on the same worker. Maximum neural batch: ${result.maxBatch}. SWA reference validated. Persistent cache: ${storage ? 'granted' : 'best effort'}. ${result.messages.join(' ')}`;
    engineReady = true; updateAnalysisButtons();
    setModelUi('ready', `${selected.name} · ready (${result.backend} ${result.precision})`);
    activationStatus.textContent = result.rootActivationLayers
      ? `${result.rootActivationLayers} GPU root layers enabled; waiting for analysis.`
      : result.rootActivationReason ?? 'Root activation retention is disabled.';
    await refreshCacheStatus();
  } catch (error) {
    if (request === lifecycle) {
      const message = String(error);
      status.textContent = message;
      setModelUi(error instanceof DOMException && error.name === 'AbortError' ? 'idle' : 'error',
        error instanceof DOMException && error.name === 'AbortError' ? 'Download cancelled' : message);
    }
  } finally {
    // Only the active generation may touch Load/Cancel — a cancelled/stale
    // load finishing later must not clobber a newer download's controls.
    if (request === lifecycle) {
      loadingModel = false;
      cancelBtn.disabled = true;
      loadBtn.disabled = Boolean(selected.disabled);
    }
  }
}

loadBtn.addEventListener('click', () => loadModel());

cancelBtn.addEventListener('click', () => {
  lifecycle++;
  loadingModel = false;
  engine.dispose();
  engineReady = false;
  analysisRunning = false;
  updateAnalysisButtons();
  setModelUi('idle', 'Download cancelled');
  status.textContent = 'Stopped. Model memory and workers released.';
  activationStatus.textContent = 'Root activations released.';
  activationStatus.dataset.lease = '';
});

clearBtn.addEventListener('click', async () => {
  try {
    const removed = await clearModelCache();
    cacheStatus.textContent = removed ? `Cache cleared (${removed} artifact(s) removed)` : 'Cache already empty';
    status.textContent = 'Model cache cleared. Load again to re-download weights.';
  } catch (error) {
    status.textContent = String(error);
  }
});

localFiles.addEventListener('change', async () => {
  const files = localFiles.files;
  if (!files?.length) return;
  try {
    localRevoke?.();
    const bundle = await bundleFromLocalFiles(files);
    localRevoke = bundle.revoke;
    input('manifest').value = bundle.manifestUrl;
    const bytes = manifestDownloadBytes(bundle.manifest, selected.preferFp16 === true);
    modelSize.textContent = `${formatBytes(bytes)} (local files, verified & cached)`;
    modelNotes.textContent = 'Local bundle staged in OPFS / object URLs. Click Load model to bind ORT (no network).';
    setModelUi('idle', 'Local files ready · not loaded into the engine yet');
    status.textContent = 'Local model files verified. Click Load model to initialize the engine.';
    await refreshCacheStatus(bundle.manifest, selected.preferFp16 === true);
  } catch (error) {
    status.textContent = String(error);
    setModelUi('error', String(error));
  } finally {
    localFiles.value = '';
  }
});

document.querySelector('#isolation')!.addEventListener('click', async () => {
  try { status.textContent = await enableIsolation(); } catch (error) { status.textContent = String(error); }
});

document.querySelector('#stop')!.addEventListener('click', () => {
  lifecycle++;
  loadingModel = false;
  engine.dispose();
  engineReady = false;
  analysisRunning = false;
  updateAnalysisButtons();
  setModelUi('idle', 'Engine stopped');
  status.textContent = 'Stopped. Model memory and workers released.';
  activationStatus.textContent = 'Root activations released.';
  activationStatus.dataset.lease = '';
  cancelBtn.disabled = true;
  loadBtn.disabled = Boolean(selected.disabled);
});

document.querySelector('#release-activations')!.addEventListener('click', () => {
  input('activations').checked = false;
  engine.releaseRootActivations();
  activationStatus.dataset.lease = '';
  activationStatus.textContent = 'Root activations released.';
});

for (const [button, count] of [[scan, 0], [deep, 12]] as const) button.addEventListener('click', () => {
  if (analysisRunning) return;
  try {
    const visits = Number(input('visits').value);
    if (!Number.isInteger(visits) || visits < 1 || visits > 10000) throw new Error('Visit budget must be an integer from 1 to 10000.');
    engine.analyze(document.querySelector<HTMLTextAreaElement>('#sgf')!.value, {
      rootVisits: visits, pvEndVisits: Math.min(visits, 100),
      deepenAll: count > 0 && input('all').checked, deepSelect: { maxDeepPlies: count },
    }, { rootSymmetries: input('symmetries').checked ? 8 : 1, batchSize: Number(input('batch').value) });
    events = []; analysisFailed = false; batchSummary = ''; output.textContent = '';
    analysisRunning = true; updateAnalysisButtons();
    status.textContent = 'Analyzing…';
  } catch (error) { status.textContent = String(error); }
});

document.querySelector('#download')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([events.join('\n') + '\n'], { type: 'application/x-ndjson' }));
  const a = document.createElement('a'); a.href = url; a.download = 'yagoo-events.ndjson'; a.click(); URL.revokeObjectURL(url);
});
