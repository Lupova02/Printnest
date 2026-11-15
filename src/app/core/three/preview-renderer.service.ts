import { Service, signal } from '@angular/core';
import * as THREE from 'three';

/**
 * EIN WebGLRenderer für die große Vorschau, wiederverwendet über alle Dateien.
 * Das Canvas wird beim Blättern nur umgehängt; bei Kontextverlust meldet `contextLost`.
 */
@Service()
export class PreviewRendererService {
  private renderer: THREE.WebGLRenderer | null = null;
  readonly contextLost = signal(false);

  /** Renderer holen und sein Canvas in `host` einhängen. */
  attach(host: HTMLElement): THREE.WebGLRenderer {
    const renderer = this.ensure();
    if (renderer.domElement.parentElement !== host) host.replaceChildren(renderer.domElement);
    return renderer;
  }

  /** Canvas aus dem DOM nehmen (Renderer bleibt für die nächste Vorschau erhalten). */
  detach(): void {
    if (!this.renderer) return;
    this.renderer.renderLists.dispose();
    this.renderer.domElement.remove();
  }

  /** Nach Kontextverlust: Renderer verwerfen, beim nächsten `attach` neu anlegen. */
  reset(): void {
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
    this.contextLost.set(false);
  }

  private ensure(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost.set(true);
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => this.contextLost.set(false));
    this.renderer = renderer;
    return renderer;
  }
}
