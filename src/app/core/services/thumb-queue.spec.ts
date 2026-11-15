import { BlobUrlCache, ThumbQueue } from './thumb-queue';

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => (resolve = r));
  return { promise, resolve };
}

describe('Thumbnail-Warteschlange', () => {
  it('läuft mit höchstens 3 Jobs parallel und bevorzugt sichtbare', async () => {
    const queue = new ThumbQueue(3);
    const order: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const job = (name: string, priority: number) => {
      const gate = deferred();
      gates.set(name, gate);
      return queue.enqueue(async () => {
        order.push(name);
        return gate.promise;
      }, { priority }).promise;
    };
    const all = [job('a', 1), job('b', 1), job('c', 1), job('d', 1), job('sichtbar', 0)];
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.active).toBe(3);
    expect(order).toEqual(['sichtbar', 'a', 'b']);
    gates.get('sichtbar')!.resolve('x');
    await new Promise((r) => setTimeout(r));
    expect(order).toEqual(['sichtbar', 'a', 'b', 'c']);
    for (const g of gates.values()) g.resolve('x');
    await Promise.all(all);
    expect(queue.peak).toBe(3);
  });

  it('bricht wartende und laufende Jobs ab', async () => {
    const queue = new ThumbQueue(1);
    let runningSignal: AbortSignal | null = null;
    const first = new AbortController();
    const second = new AbortController();
    const p1 = queue.enqueue((signal) => {
      runningSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abgebrochen'))));
    }, { signal: first.signal }).promise;
    const p2 = queue.enqueue(async () => 'nie', { signal: second.signal }).promise;
    await Promise.resolve();
    second.abort();
    await expect(p2).rejects.toThrow();
    first.abort();
    await expect(p1).rejects.toThrow();
    expect(runningSignal!.aborted).toBe(true);
  });

  it('LRU gibt verdrängte Objekt-URLs frei', () => {
    const revoked: string[] = [];
    const cache = new BlobUrlCache(2, 1000, (url) => revoked.push(url));
    cache.set('a', 'blob:a', 10);
    cache.set('b', 'blob:b', 10);
    expect(cache.get('a')).toBe('blob:a');
    cache.set('c', 'blob:c', 10);
    expect(revoked).toEqual(['blob:b']);
    cache.set('d', 'blob:d', 995);
    expect(cache.size).toBe(1);
  });
});
