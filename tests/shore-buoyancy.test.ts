import { describe, expect, it } from 'vitest';
import { shoreScene } from '../src/scenes/shore/index';

/**
 * The shore is the one scene that places the buoyancy itself: the dome is the
 * horizon and must not move, the near layers carry the full amplitude.
 */
function part(handle: { root: import('three').Object3D }, name: string) {
  const node = handle.root.getObjectByName(name);
  if (!node) {
    throw new Error(`missing ${name}`);
  }
  return node;
}

describe('shore buoyancy distribution', () => {
  it('moves the near layers and leaves the dome still', () => {
    const handle = shoreScene.build({ registry: null as never });
    // Standing frame: the visual up is the lake's up.
    handle.applyBuoyancy?.({ amountM: 0.05, axis: { x: 0, y: 1, z: 0 } });

    const dome = part(handle, 'shore-dome');
    const water = part(handle, 'shore-water');
    const shore = part(handle, 'shore-shoreline');
    const clouds = part(handle, 'shore-clouds');

    expect(dome.position.y).toBe(0);
    expect(dome.rotation.x).toBe(0);
    expect(water.position.y).toBeCloseTo(0.05, 6);
    expect(shore.position.y).toBeCloseTo(0.05, 6);
    expect(clouds.position.y).toBeCloseTo(0.02, 6);
    // The horizon never tilts: no rotation is written, on any layer.
    expect(water.rotation.x).toBe(0);
    expect(dome.rotation.x).toBe(0);

    handle.dispose();
  });

  it('heaves the lake relative to stationary posts during buoyancy', () => {
    const handle = shoreScene.build({ registry: null as never });
    const water = part(handle, 'shore-water');
    const swell = part(handle, 'shore-swell');
    const shore = part(handle, 'shore-shoreline');
    handle.applyBuoyancy?.({ amountM: 0.05, axis: { x: 0, y: 1, z: 0 } });

    // A quarter period (5.5 s of 22 s) lands on the crest; three quarters on
    // the trough. The exact amplitude is the comfort envelope's business
    // (see the scene capabilities test), not this one's.
    handle.update?.(5.5, 5.5);
    const crest = swell.position.y;
    expect(Math.abs(crest)).toBeGreaterThan(0.005);
    expect(Math.abs(crest)).toBeLessThan(0.05);
    expect(swell.position.y + water.position.y - shore.position.y).toBeCloseTo(crest, 6);

    handle.update?.(11, 16.5);
    expect(swell.position.y).toBeCloseTo(-crest, 6);
    expect(swell.position.y + water.position.y - shore.position.y).toBeCloseTo(-crest, 6);
    handle.dispose();
  });

  it('follows the axis when the visual up is not the lake up', () => {
    const handle = shoreScene.build({ registry: null as never });
    // Supine frame: the patient's up runs along the scene's depth.
    handle.applyBuoyancy?.({ amountM: 0.05, axis: { x: 0, y: 0, z: 1 } });

    expect(part(handle, 'shore-water').position.z).toBeCloseTo(0.05, 6);
    expect(part(handle, 'shore-water').position.y).toBeCloseTo(0, 6);
    expect(part(handle, 'shore-dome').position.z).toBe(0);

    handle.dispose();
  });

  it('returns everything to rest', () => {
    const handle = shoreScene.build({ registry: null as never });
    handle.applyBuoyancy?.({ amountM: -0.04, axis: { x: 0, y: 1, z: 0 } });
    handle.applyBuoyancy?.({ amountM: 0, axis: { x: 0, y: 1, z: 0 } });

    expect(part(handle, 'shore-water').position.y).toBe(0);
    expect(part(handle, 'shore-shoreline').position.y).toBe(0);
    expect(part(handle, 'shore-water').rotation.x).toBe(0);
    expect(part(handle, 'shore-dome').position.y).toBe(0);

    handle.dispose();
  });
});
