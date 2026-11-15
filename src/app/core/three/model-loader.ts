import * as THREE from 'three';
import { ModelKind, ParsedModel } from './model-parse';
import { loadParsedModel, ModelLoadOptions } from './model-worker-client';

export type { ModelKind } from './model-parse';

export const MODEL_COLORS: Record<ModelKind, number> = {
  stl: 0x7ec8e3,
  '3mf': 0x2fbf71,
};

export interface ModelStats {
  /** Bounding Box in Modelleinheiten (STL/3MF: üblicherweise mm). */
  size: { x: number; y: number; z: number };
  /** Dreiecke in der Datei. */
  triangles: number;
  /** Angezeigte Dreiecke (bei Vereinfachung kleiner). */
  shownTriangles: number;
  simplified: boolean;
}

export interface LoadedModel {
  object: THREE.Object3D;
  stats: ModelStats;
}

/**
 * Geparste Geometrie (Worker) in ein Three-Objekt verwandeln. Positionen sind bereits
 * zentriert, Normalen vorberechnet – hier fällt keine teure Arbeit mehr an.
 */
export function buildModelObject(parsed: ParsedModel, kind: ModelKind): LoadedModel {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: MODEL_COLORS[kind], metalness: 0.15, roughness: 0.45 }),
  );
  // Druckbett-Ausrichtung (Z oben) → Three.js (Y oben).
  mesh.rotation.x = -Math.PI / 2;
  const wrapper = new THREE.Group();
  wrapper.add(mesh);
  wrapper.updateMatrixWorld(true);
  return {
    object: wrapper,
    stats: {
      size: parsed.size,
      triangles: parsed.sourceTriangles,
      shownTriangles: parsed.triangles,
      simplified: parsed.simplified,
    },
  };
}

/** STL/3MF im Worker laden und als Three-Objekt liefern. */
export async function loadModel(url: string, kind: ModelKind, options: ModelLoadOptions = {}): Promise<LoadedModel> {
  return buildModelObject(await loadParsedModel(url, kind, options), kind);
}

/** Kamera so platzieren, dass das Objekt vollständig sichtbar ist; liefert die Distanz. */
export function fitCamera(camera: THREE.PerspectiveCamera, object: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = sphere.radius || 1;
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 1.08;
  camera.position.set(distance * 0.62, distance * 0.48, distance * 0.62);
  camera.near = Math.max(distance / 200, 0.01);
  camera.far = distance * 20;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return distance;
}

export function addStudioLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xe6f7ff, 0x1a2228, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(3, 5, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fd4e8, 0.45);
  rim.position.set(-2, 1, -3);
  scene.add(rim);
}

export function disposeObject(object: THREE.Object3D | null): void {
  object?.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
    child.geometry?.dispose();
    const material = child.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
