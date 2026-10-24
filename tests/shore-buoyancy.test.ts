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
