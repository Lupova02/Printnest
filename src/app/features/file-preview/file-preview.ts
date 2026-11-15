import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FileKind, LibraryService } from '../../core/services/library.service';
import { ModelStats, addStudioLights, disposeObject, fitCamera, loadModel } from '../../core/three/model-loader';
import { LoadProgress } from '../../core/three/model-worker-client';
import { PreviewRendererService } from '../../core/three/preview-renderer.service';
import { Icon } from '../../shared/icon/icon';
import { VideoPlayer } from './video-player/video-player';

/** pdf.js erst laden, wenn ein PDF angezeigt wird (kleineres Bundle, schnellerer Start). */
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjs;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Große Dateivorschau: STL/3MF (Worker-Parser, ein geteilter WebGLRenderer, Render-on-Demand),
 * PDF (PDF.js mit Blättern/Zoom), Video (eigener Player) und Bilder/F3D-Vorschau.
 */
@Component({
  selector: 'app-file-preview',
  imports: [Icon, NgTemplateOutlet, VideoPlayer],
  templateUrl: './file-preview.html',
  styleUrl: './file-preview.scss',
})
export class FilePreview {
  private readonly api = inject(LibraryService);
  private readonly renderers = inject(PreviewRendererService);

  readonly kind = input.required<FileKind | null>();
  readonly relativePath = input.required<string>();
  /** Ändert sich, wenn die Datei neu geladen werden soll (z. B. mtime). */
  readonly version = input<string | null>(null);

  protected readonly status = signal<Status>('idle');
  protected readonly progress = signal<LoadProgress | null>(null);
  protected readonly stats = signal<ModelStats | null>(null);
  protected readonly wireframe = signal(false);
  protected readonly pdfPage = signal(1);
  protected readonly pdfPageCount = signal(0);
  protected readonly pdfZoom = signal(1);
  protected readonly contextLost = this.renderers.contextLost;

  protected readonly mediaUrl = computed(() => this.api.mediaUrl(this.relativePath()));
  /** F3D: eingebettetes Vorschaubild in höchster verfügbarer Auflösung. */
  protected readonly previewUrl = computed(() => this.api.previewUrl(this.relativePath(), 1024, 'large'));
  protected readonly pdfZoomPercent = computed(() => Math.round(this.pdfZoom() * 100));
  protected readonly progressPercent = computed(() => {
    const p = this.progress();
    return p?.fraction == null ? null : Math.round(p.fraction * 100);
  });

  protected readonly dimensions = computed(() => {
    const s = this.stats();
    if (!s) return '';
    const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    return `${fmt(s.size.x)} × ${fmt(s.size.y)} × ${fmt(s.size.z)} mm`;
  });
  protected readonly triangles = computed(() => (this.stats()?.triangles ?? 0).toLocaleString('de-DE'));
  protected readonly shownTriangles = computed(() => (this.stats()?.shownTriangles ?? 0).toLocaleString('de-DE'));

  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly pdfCanvas = viewChild<ElementRef<HTMLCanvasElement>>('pdfCanvas');
  private readonly pdfScroll = viewChild<ElementRef<HTMLElement>>('pdfScroll');
  private readonly videoPlayer = viewChild(VideoPlayer);

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private model: THREE.Object3D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pdfDoc: PDFDocumentProxy | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private frame = 0;

  constructor() {
    effect(() => {
      const kind = this.kind();
      this.relativePath();
      this.version();
      untracked(() => void this.load(kind));
    });
    // Kontext verloren → Szene verwerfen; Fallback-Meldung zeigt das Template.
    effect(() => {
      if (this.contextLost()) untracked(() => this.teardown());
    });
    inject(DestroyRef).onDestroy(() => {
      this.generation += 1;
      this.teardown();
      this.renderers.detach();
    });
  }

  /** Tasten für Video (aus der Vorschau weitergereicht). Liefert true, wenn behandelt. */
  handleMediaKey(event: KeyboardEvent): boolean {
    const player = this.videoPlayer();
    if (!player) return false;
    const key = event.key.toLowerCase();
    if (key === 'k') player.togglePlay();
    else if (key === 'm') player.toggleMute();
    else if (key === 'f') player.toggleFullscreen();
    else if (event.shiftKey && event.key === 'ArrowLeft') player.seekBy(-5);
    else if (event.shiftKey && event.key === 'ArrowRight') player.seekBy(5);
    else return false;
    return true;
  }

  /** Nach Kontextverlust neuen Renderer anlegen und erneut laden. */
  protected retryWebGl(): void {
    this.renderers.reset();
    void this.load(this.kind());
  }

  private async load(kind: FileKind | null): Promise<void> {
    const generation = ++this.generation;
    // Laufenden Download/Parse abbrechen, wenn weitergeblättert wird.
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.teardown();
    this.stats.set(null);
    this.progress.set(null);
    this.status.set('loading');
    const stillValid = () => generation === this.generation;

    try {
      if (kind === 'stl' || kind === '3mf') {
        if (this.contextLost()) this.renderers.reset();
        const loaded = await loadModel(this.mediaUrl(), kind, {
          signal: abort.signal,
          onProgress: (p) => {
            if (stillValid()) this.progress.set(p);
          },
        });
        if (!stillValid()) {
          disposeObject(loaded.object);
          return;
        }
        await this.waitForView();
        this.setupScene(loaded.object);
        this.stats.set(loaded.stats);
        this.status.set('ready');
      } else if (kind === 'pdf') {
        await this.waitForView();
        const { getDocument } = await loadPdfJs();
        const doc = await getDocument({ url: this.mediaUrl() }).promise;
        if (!stillValid()) {
          void doc.loadingTask.destroy();
          return;
        }
        this.pdfDoc = doc;
        this.pdfPageCount.set(doc.numPages);
        this.pdfPage.set(1);
        this.pdfZoom.set(1);
        await this.renderPdfPage(true);
        this.status.set('ready');
      }
      // Bilder/Video melden „ready“ über (load)/(loadeddata).
    } catch (error) {
      if (stillValid() && !(error instanceof DOMException && error.name === 'AbortError')) this.status.set('error');
    } finally {
      if (stillValid()) this.progress.set(null);
    }
  }

  /** Warten, bis das Ziel-Element im DOM steht. */
  private async waitForView(): Promise<void> {
    for (let i = 0; i < 30 && !this.viewport() && !this.pdfCanvas(); i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  // --- 3D ---

  private setupScene(object: THREE.Object3D): void {
    const host = this.viewport()?.nativeElement;
    if (!host) throw new Error('viewport missing');
    const width = host.clientWidth || 640;
    const height = host.clientHeight || 460;

    const scene = new THREE.Scene();
    addStudioLights(scene);
    scene.add(object);

    const box = new THREE.Box3().setFromObject(object);
    const grid = new THREE.GridHelper(
      Math.max(box.getSize(new THREE.Vector3()).length() * 1.4, 10),
      20,
      0x5eb8d4,
      0x5eb8d4,
    );
    grid.position.y = box.min.y;
    (grid.material as THREE.Material).opacity = 0.18;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 5000);
    const distance = fitCamera(camera, object);

    const renderer = this.renderers.attach(host);
    renderer.setSize(width, height, false);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = true;
    controls.zoomSpeed = 1.1;
    controls.minDistance = distance * 0.1;
    controls.maxDistance = distance * 8;
    // Render-on-Demand: nur bei Interaktion zeichnen, keine Dauerschleife.
    controls.addEventListener('change', () => this.requestRender());
    controls.saveState();

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.model = object;
    this.applyWireframe();

    this.resizeObserver = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h || !this.camera || !this.renderer) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      this.requestRender();
    });
    this.resizeObserver.observe(host);
    this.render();
  }

  /** Höchstens ein Frame pro Animationstakt. */
  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    if (this.renderer && this.scene && this.camera && !this.contextLost()) this.renderer.render(this.scene, this.camera);
  }

  protected resetView(): void {
    this.controls?.reset();
    this.requestRender();
  }

  protected toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    this.applyWireframe();
  }

  private applyWireframe(): void {
    const on = this.wireframe();
    this.model?.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of materials) (m as THREE.MeshStandardMaterial).wireframe = on;
      }
    });
    this.requestRender();
  }

  // --- PDF ---

  protected pdfPrev(): void {
    if (this.pdfPage() <= 1) return;
    this.pdfPage.update((p) => p - 1);
    void this.renderPdfPage(true);
  }

  protected pdfNext(): void {
    if (this.pdfPage() >= this.pdfPageCount()) return;
    this.pdfPage.update((p) => p + 1);
    void this.renderPdfPage(true);
  }

  protected pdfZoomBy(factor: number): void {
    const next = Math.min(4, Math.max(0.5, Math.round(this.pdfZoom() * factor * 100) / 100));
    if (next === this.pdfZoom()) return;
    this.pdfZoom.set(next);
    void this.renderPdfPage(false);
  }

  protected onPdfWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    this.pdfZoomBy(event.deltaY < 0 ? 1.25 : 0.8);
  }

  private pdfToken = 0;

  private async renderPdfPage(resetScroll: boolean): Promise<void> {
    const doc = this.pdfDoc;
    const canvas = this.pdfCanvas()?.nativeElement;
    const scroll = this.pdfScroll()?.nativeElement;
    if (!doc || !canvas) return;
    const token = ++this.pdfToken;
    const page = await doc.getPage(this.pdfPage());
    if (token !== this.pdfToken) return;

    const base = page.getViewport({ scale: 1 });
    const available = Math.max((scroll?.clientWidth || 640) - 24, 120);
    const viewport = page.getViewport({ scale: (available / base.width) * this.pdfZoom() });
    const context = canvas.getContext('2d');
    if (!context) return;
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    if (resetScroll && scroll) scroll.scrollTo({ top: 0, left: 0 });
  }

  // --- Medien ---

  protected onMediaReady(): void {
    this.status.set('ready');
  }

  protected onMediaError(): void {
    this.status.set('error');
  }

  /** Szene und Dokument freigeben; der geteilte Renderer bleibt bestehen. */
  private teardown(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls?.dispose();
    this.controls = null;
    disposeObject(this.model);
    this.scene?.traverse((child) => {
      if (child instanceof THREE.LineSegments) disposeObject(child);
    });
    this.model = null;
    this.renderer?.renderLists.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    if (this.pdfDoc) {
      void this.pdfDoc.loadingTask.destroy();
      this.pdfDoc = null;
    }
    this.pdfPageCount.set(0);
  }
}
