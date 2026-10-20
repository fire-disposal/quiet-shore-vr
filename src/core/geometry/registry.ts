import type * as THREE from 'three';
import type { ResourceStats } from './types';

/**
 * Reference-counted ownership of GPU resources.
 *
 * Every geometry/material/texture is created through `acquire*` and lives
 * while at least one reference is held. The last `release()` disposes the
 * value and removes the key, so identical keys always share one GPU object.
 */

export type ResourceKind = 'geometry' | 'material' | 'texture';

export interface ResourceRef<T> {
  readonly value: T;
  /** Drop one reference. Idempotent per ref; disposes at zero. */
  release(): void;
}

type AnyResource = THREE.BufferGeometry | THREE.Material | THREE.Texture;

interface Entry {
  value: AnyResource;
  refs: number;
  /** Set once the registry disposed the value; later releases become no-ops. */
  disposed: boolean;
}

export class ResourceRegistry {
  private readonly entries: Record<ResourceKind, Map<string, Entry>> = {
    geometry: new Map<string, Entry>(),
    material: new Map<string, Entry>(),
    texture: new Map<string, Entry>()
  };

  acquireGeometry(
    key: string,
    factory: () => THREE.BufferGeometry
  ): ResourceRef<THREE.BufferGeometry> {
    return this.acquire('geometry', key, factory);
  }

  acquireMaterial(key: string, factory: () => THREE.Material): ResourceRef<THREE.Material> {
    return this.acquire('material', key, factory);
  }

  acquireTexture(key: string, factory: () => THREE.Texture): ResourceRef<THREE.Texture> {
    return this.acquire('texture', key, factory);
  }

  get(kind: ResourceKind, key: string): AnyResource | undefined {
    return this.entries[kind].get(key)?.value;
  }

  refCount(kind: ResourceKind, key: string): number {
    return this.entries[kind].get(key)?.refs ?? 0;
  }

  /** Live resource counts; draw/triangle counts belong to SceneBudget.measureObject. */
  stats(): ResourceStats {
    return {
      geometries: this.entries.geometry.size,
      materials: this.entries.material.size,
      textures: this.entries.texture.size,
      drawCalls: 0,
      triangles: 0
    };
  }

  /** Dispose everything and forget all keys. Outstanding refs become no-ops. */
  disposeAll(): void {
    const kinds: ResourceKind[] = ['geometry', 'material', 'texture'];
    for (let k = 0; k < kinds.length; k++) {
      const map = this.entries[kinds[k]];
      map.forEach((entry) => {
        if (!entry.disposed) {
          entry.disposed = true;
          entry.value.dispose();
        }
      });
      map.clear();
    }
  }

  private acquire<T extends AnyResource>(
    kind: ResourceKind,
    key: string,
    factory: () => T
  ): ResourceRef<T> {
    const map = this.entries[kind];
    let entry = map.get(key);
    if (!entry) {
      entry = { value: factory(), refs: 0, disposed: false };
      map.set(key, entry);
    }
    entry.refs += 1;
    const target = entry;
    let released = false;
    return {
      value: entry.value as T,
      release: (): void => {
        if (released) return;
        released = true;
        target.refs -= 1;
        if (target.refs > 0) return;
        if (map.get(key) === target) map.delete(key);
        if (!target.disposed) {
          target.disposed = true;
          target.value.dispose();
        }
      }
    };
  }
}
