/// <reference lib="webworker" />
import { parseModel } from './model-parse';
import { ModelWorkerMessage, ModelWorkerRequest } from './model-worker.types';

/** Lädt und parst STL/3MF abseits des UI-Threads; Geometrie geht als Transferable zurück. */
addEventListener('message', async ({ data }: MessageEvent<ModelWorkerRequest>) => {
  const post = (message: ModelWorkerMessage, transfer: Transferable[] = []) => postMessage(message, transfer);
  try {
    const res = await fetch(data.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('Content-Length')) || null;
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastReport = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const now = performance.now();
      if (now - lastReport > 60) {
        lastReport = now;
        post({ type: 'progress', loaded, total });
      }
    }
    post({ type: 'progress', loaded, total: total ?? loaded });
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    post({ type: 'parsing' });
    const model = parseModel(bytes, data.kind);
    post({ type: 'done', model }, [model.positions.buffer, model.normals.buffer]);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
