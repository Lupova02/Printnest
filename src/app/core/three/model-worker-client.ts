import { ModelKind, ParsedModel, parseModel } from './model-parse';
import { ModelWorkerMessage } from './model-worker.types';

export interface LoadProgress {
  phase: 'download' | 'parse';
  /** 0–1, null = unbekannt. */
  fraction: number | null;
}

export interface ModelLoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
}

function abortError(): DOMException {
  return new DOMException('Laden abgebrochen.', 'AbortError');
}

/**
 * STL/3MF in einem eigenen Worker laden und parsen. Bei Abbruch wird der Worker
 * beendet – Download und Parsen stoppen sofort.
 */
export function loadParsedModel(url: string, kind: ModelKind, options: ModelLoadOptions = {}): Promise<ParsedModel> {
  const { signal, onProgress } = options;
  if (signal?.aborted) return Promise.reject(abortError());
  const absolute = new URL(url, location.href).href;

  if (typeof Worker === 'undefined') return loadOnMainThread(absolute, kind, options);

  return new Promise<ParsedModel>((resolve, reject) => {
    const worker = new Worker(new URL('./model.worker', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<ModelWorkerMessage>) => {
      if (data.type === 'progress') {
        onProgress?.({ phase: 'download', fraction: data.total ? data.loaded / data.total : null });
      } else if (data.type === 'parsing') {
        onProgress?.({ phase: 'parse', fraction: null });
      } else if (data.type === 'done') {
        finish();
        resolve(data.model);
      } else {
        finish();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Worker-Fehler'));
    };
    worker.postMessage({ url: absolute, kind });
  });
}

/** Fallback ohne Worker (Tests, sehr alte Umgebungen). */
async function loadOnMainThread(url: string, kind: ModelKind, { signal, onProgress }: ModelLoadOptions): Promise<ParsedModel> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  onProgress?.({ phase: 'parse', fraction: null });
  if (signal?.aborted) throw abortError();
  return parseModel(bytes, kind);
}
