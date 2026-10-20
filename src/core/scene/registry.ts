import type { SceneDefinition } from './contract';

/** Id → scene definition table, in registration order. */
export class SceneRegistry {
  private readonly scenes = new Map<string, SceneDefinition>();

  get size(): number {
    return this.scenes.size;
  }

  /** Register a scene; duplicate ids are rejected so navigation stays unambiguous. */
  register(definition: SceneDefinition): SceneDefinition {
    if (this.scenes.has(definition.id)) {
      throw new Error(`SceneRegistry: duplicate scene id "${definition.id}"`);
    }
    this.scenes.set(definition.id, definition);
    return definition;
  }

  unregister(id: string): boolean {
    return this.scenes.delete(id);
  }

  get(id: string): SceneDefinition | undefined {
    return this.scenes.get(id);
  }

  has(id: string): boolean {
    return this.scenes.has(id);
  }

  list(): SceneDefinition[] {
    return Array.from(this.scenes.values());
  }

  clear(): void {
    this.scenes.clear();
  }
}
