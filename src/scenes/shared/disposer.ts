/**
 * Collects everything a scene built so `dispose` is one call.
 *
 * Geometries, materials and textures share only `dispose()`, so the scenes do
 * not need three typed arrays and a null check each time a texture might be
 * headless.
 */
export interface Disposable {
  dispose(): void;
}

export class Disposer {
  private readonly items: Disposable[] = [];

  add(...values: (Disposable | null | undefined)[]): void {
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (value) {
        this.items.push(value);
      }
    }
  }

  disposeAll(): void {
    for (let i = 0; i < this.items.length; i += 1) {
      this.items[i].dispose();
    }
    this.items.length = 0;
  }
}
