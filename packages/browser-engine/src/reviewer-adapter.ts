import { BrowserEngine, type PositionAnalysisRequest } from './client';
import { coded, isParams } from './errors';
import { bundleFromLocalFiles } from './model';

/**
 * `BrowserEngineAdapter` for the docs reviewer.
 * Local files are verified up front. ORT starts only when analysis is requested.
 */
export class ReviewerBrowserEngine {
  private readonly engine = new BrowserEngine();
  private manifestUrl: string | null = null;
  private initializedFor: string | null = null;
  private revoke: (() => void) | undefined;
  private cancelActive: (() => void) | undefined;
  private generation = 0;

  async stageLocal(files: Iterable<File>): Promise<string> {
    this.stop();
    const generation = this.generation;
    const bundle = await bundleFromLocalFiles(files);
    if (generation !== this.generation) {
      bundle.revoke();
      throw new DOMException('Model staging was cancelled.', 'AbortError');
    }
    this.revoke?.();
    this.revoke = bundle.revoke;
    this.manifestUrl = bundle.manifestUrl;
    return bundle.manifest.model;
  }

  stageRemote(url: string): void {
    const trimmed = url.trim();
    if (!trimmed) throw coded('engine.manifestUrlRequired', 'A manifest URL is required.');
    this.stop();
    this.revoke?.();
    this.revoke = undefined;
    this.manifestUrl = trimmed;
  }

  get ready(): boolean {
    return this.manifestUrl != null;
  }

  stop(): void {
    this.generation++;
    // Wake the generator before terminating its worker.
    this.cancelActive?.();
    this.cancelActive = undefined;
    this.initializedFor = null;
    this.engine.dispose();
  }

  dispose(): void {
    this.stop();
    this.revoke?.();
    this.revoke = undefined;
    this.manifestUrl = null;
  }

  analyzeSgf(sgf: string): AsyncIterable<string> {
    return this.stream(() => this.engine.analyze(sgf));
  }

  analyzePosition(request: PositionAnalysisRequest): AsyncIterable<string> {
    return this.stream(() => this.engine.analyzePosition(request));
  }

  private async *stream(start: () => void): AsyncIterable<string> {
    if (this.cancelActive) this.stop();
    const manifestUrl = this.manifestUrl;
    if (!manifestUrl) throw coded('engine.modelRequired', 'Load a local model bundle before starting the browser engine.');
    const generation = ++this.generation;
    const queue: string[] = [];
    let notify: (() => void) | undefined;
    let cancelled = false;
    let done = false;
    let failure: Error | undefined;
    const wake = () => { notify?.(); notify = undefined; };
    this.cancelActive = () => { cancelled = true; queue.length = 0; wake(); };
    try {
      if (this.initializedFor !== manifestUrl) {
        await this.engine.initialize(manifestUrl);
        if (cancelled || generation !== this.generation) return;
        this.initializedFor = manifestUrl;
      }
      this.engine.onMessage = (message) => {
        if (cancelled || generation !== this.generation) return;
        if (message.type === 'event') queue.push(JSON.stringify(message.event));
        else if (message.type === 'error') {
          const text = String(message.message ?? message.code ?? 'engine.worker');
          const code = typeof message.code === 'string' ? message.code : 'engine.worker';
          const params = isParams(message.params) ? message.params : { detail: text };
          failure = coded(code, text, params);
        }
        else if (message.type === 'done') done = true;
        wake();
      };
      start();
      for (;;) {
        if (cancelled) return;
        while (queue.length && !cancelled) yield queue.shift()!;
        if (failure) throw failure;
        if (done || cancelled) return;
        await new Promise<void>((resolve) => { notify = resolve; });
      }
    } catch (error) {
      if (!cancelled) throw error;
    } finally {
      if (generation === this.generation) {
        this.cancelActive = undefined;
        this.engine.onMessage = () => {};
        if (!done) { this.initializedFor = null; this.engine.dispose(); }
      }
    }
  }
}
