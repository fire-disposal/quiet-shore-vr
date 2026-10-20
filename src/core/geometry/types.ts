import type * as THREE from 'three';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type FramePhase = 'input' | 'simulation' | 'animation' | 'layout' | 'render';

export interface TransformSpec {
  position?: Vec3;
  /** Euler degrees, applied in YXZ order. */
  rotationDeg?: Vec3;
  quaternion?: Quat;
  scale?: Vec3 | number;
  /** Stable sibling order for transform application. Lower runs first. */
  order?: number;
}

export interface MaterialSpec {
  color?: number;
  map?: string;
  transparent?: boolean;
  opacity?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  side?: 'front' | 'back' | 'double';
}

export type GeometryKind = 'box' | 'plane' | 'sphere' | 'cylinder' | 'rounded-plane';

export interface GeometrySpec {
  id: string;
  kind: GeometryKind;
  params: Record<string, number>;
  transform?: TransformSpec;
  material?: MaterialSpec;
  parent?: string;
  order?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface GeometryHandle {
  object: THREE.Object3D;
  dispose(): void;
}

export interface FrameTask {
  id: string;
  phase: FramePhase;
  order: number;
  run(dt: number, now: number): void;
}

export interface ResourceStats {
  geometries: number;
  materials: number;
  textures: number;
  drawCalls: number;
  triangles: number;
}

export interface BudgetLimits {
  geometries?: number;
  materials?: number;
  textures?: number;
  drawCalls?: number;
  triangles?: number;
}
