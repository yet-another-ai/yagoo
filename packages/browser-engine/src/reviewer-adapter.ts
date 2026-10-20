import { BrowserEngine } from './client';
import { bundleFromLocalFiles } from './model';

/**
 * `BrowserEngineAdapter` for the docs reviewer.
 * Local files are verified up front. ORT starts only when analysis is requested.
 */
export class ReviewerBrowserEngine {
  private readonly engine = new BrowserEngine();
  private manifestUrl: string | null = null;
  private revoke: (() => void) | undefined;

  async stageLocal(files: Iterable<File>): Promise<string> {
    this.revoke?.();
    const bundle = await bundleFromLocalFiles(files);
    this.revoke = bundle.revoke;
    this.manifestUrl = bundle.manifestUrl;
    return bundle.manifest.model;
  }

  stageRemote(url: string): void {
    const trimmed = url.trim();
    if (!trimmed) throw new Error('A manifest URL is required.');
    this.revoke?.();
    this.revoke = undefined;
    this.manifestUrl = trimmed;
  }

  get ready(): boolean {
    return this.manifestUrl != null;
  }

  stop(): void {
    this.engine.dispose();
  }

  analyzeSgf(sgf: string): AsyncIterable<string> {
    const manifestUrl = this.manifestUrl;
    const engine = this.engine;
    return (async function* () {
      if (!manifestUrl) throw new Error('Load a local model bundle before starting the browser engine.');
      await engine.initialize(manifestUrl);
      const queue: string[] = [];
      let notify: (() => void) | undefined;
      let done = false;
      let failure: Error | undefined;
      const wake = () => {
        notify?.();
        notify = undefined;
      };
      engine.onMessage = (message) => {
        if (message.type === 'event') queue.push(JSON.stringify(message.event));
        else if (message.type === 'error') failure = new Error(String(message.message));
        else if (message.type === 'done') done = true;
        wake();
      };
      engine.analyze(sgf);
      while (!done && !failure) {
        if (queue.length === 0) await new Promise<void>((resolve) => { notify = resolve; });
        while (queue.length) yield queue.shift()!;
      }
      while (queue.length) yield queue.shift()!;
      if (failure) throw failure;
    })();
  }
}
