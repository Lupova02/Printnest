import { Service, inject } from '@angular/core';
import * as THREE from 'three';
import { firstValueFrom } from 'rxjs';
import { ModelKind, addStudioLights, buildModelObject, disposeObject, fitCamera } from '../three/model-loader';
import { loadParsedModel } from '../three/model-worker-client';
import { LibraryService } from './library.service';
import { BlobUrlCache, QueueHandle, ThumbQueue, abortError } from './thumb-queue';

const THUMB_SIZE = 320;

/** Was für eine Kachel geladen werden soll. */
export interface ThumbRequest {
  key: string;
  /** URL des fertigen Bildes (Server-Cache, Bild, PDF/F3D-Vorschau). */
  url: string;
  /** STL/3MF: Fehlt das Server-Thumbnail (404), wird es gerendert. */
  model?: { relativePath: string; kind: ModelKind };
}

/**
 * Vorschaubilder für Liste/Raster:
 * - Warteschlange mit max. 3 parallelen Jobs, sichtbare Kacheln zuerst, abbrechbar,
 * - In-Memory-LRU (Objekt-URLs) vor dem Server-Cache (.preview-cache),
 * - STL/3MF werden bei Bedarf mit EINEM Offscreen-Renderer nacheinander gerendert
 *   (Parsen im Worker) und im Server-Cache abgelegt – nie ein WebGL-Kontext pro Kachel.
 */
@Service()
export class ThumbnailService {
  private readonly library = inject(LibraryService);
  readonly queue = new ThumbQueue(3);
  readonly cache = new BlobUrlCache();
  private renderer: THREE.WebGLRenderer | null = null;
  /** Serialisiert das Rendern auf den einen Offscreen-Renderer. */
  private renderChain: Promise<unknown> = Promise.resolve();

  /** Sofort verfügbare Objekt-URL aus dem Speicher (oder null). */
  cached(key: string): string | null {
    return this.cache.get(key);
  }

  /** Thumbnail anfordern; liefert eine Objekt-URL (null = keins möglich). */
  request(req: ThumbRequest, options: { priority?: number; signal?: AbortSignal } = {}): QueueHandle<string | null> {
    return this.queue.enqueue(async (signal) => {
      const hit = this.cache.get(req.key);
      if (hit) return hit;
      let blob = await this.fetchImage(req.url, signal);
      if (!blob && req.model) blob = await this.renderModel(req.model.relativePath, req.model.kind, signal);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      this.cache.set(req.key, url, blob.size);
      return url;
    }, options);
  }

  private async fetchImage(url: string, signal: AbortSignal): Promise<Blob | null> {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return res.blob();
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.renderer = null;
      });
    }
    return this.renderer;
  }

  private async renderModel(relativePath: string, kind: ModelKind, signal: AbortSignal): Promise<Blob | null> {
    let parsed;
    try {
      parsed = await loadParsedModel(this.library.mediaUrl(relativePath), kind, { signal });
    } catch (error) {
      if (signal.aborted) throw abortError();
      return null;
    }
    const job = this.renderChain.then(async () => {
      if (signal.aborted) throw abortError();
      const { object } = buildModelObject(parsed, kind);
      try {
        const renderer = this.ensureRenderer();
        const scene = new THREE.Scene();
        addStudioLights(scene);
        scene.add(object);
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
        fitCamera(camera, object);
        renderer.render(scene, camera);
        renderer.renderLists.dispose();
        return await new Promise<Blob | null>((resolve) => renderer.domElement.toBlob((b) => resolve(b), 'image/png'));
      } finally {
        disposeObject(object);
      }
    });
    this.renderChain = job.catch(() => null);
    const blob = await job;
    // Server-Cache befüllen; Fehler sind hier nicht kritisch.
    if (blob) void firstValueFrom(this.library.saveThumb(relativePath, blob)).catch(() => {});
    return blob;
  }
}
