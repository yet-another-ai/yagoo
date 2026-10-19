import type { PipelineEvent } from "../types";

/**
 * One interface for every analysis event producer.
 * All sources emit the same NDJSON `PipelineEvent` stream that
 * `yagoo-pipeline` / `yagoo analyze` write.
 */
export interface AnalysisEventSource {
  readonly id: string;
  readonly label: string;
  /**
   * Subscribe to progressive events. Returns an unsubscribe / abort handle.
   * Implementations should call `onEvent` in pipeline order and `onDone`/`onError`
   * when finished.
   */
  start(handlers: AnalysisSourceHandlers): AnalysisSourceHandle;
}

export interface AnalysisSourceHandlers {
  onEvent: (event: PipelineEvent) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export interface AnalysisSourceHandle {
  stop: () => void;
}
