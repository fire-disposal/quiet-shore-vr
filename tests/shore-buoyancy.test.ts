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
    const handle = shoreScene.build({ eyeHeight: 1.6, registry: null as never });
    handle.applyBuoyancy?.({ amountM: 0.05, swayDeg: 1 });

    const dome = part(handle, 'shore-dome');
    const water = part(handle, 'shore-water');
    const shore = part(handle, 'shore-shoreline');
    const clouds = part(handle, 'shore-clouds');

    expect(dome.position.y).toBe(0);
    expect(dome.rotation.x).toBe(0);
    expect(water.position.y).toBeCloseTo(0.05, 6);
    expect(shore.position.y).toBeCloseTo(0.05, 6);
    expect(clouds.position.y).toBeCloseTo(0.02, 6);
    expect(water.rotation.x).toBeCloseTo(Math.PI / 180, 6);
    expect(dome.rotation.x).toBe(0);

    handle.dispose();
  });

  it('returns everything to rest', () => {
    const handle = shoreScene.build({ eyeHeight: 1.6, registry: null as never });
    handle.applyBuoyancy?.({ amountM: -0.04, swayDeg: -1.5 });
    handle.applyBuoyancy?.({ amountM: 0, swayDeg: 0 });

    expect(part(handle, 'shore-water').position.y).toBe(0);
    expect(part(handle, 'shore-shoreline').position.y).toBe(0);
    expect(part(handle, 'shore-water').rotation.x).toBe(0);
    expect(part(handle, 'shore-dome').position.y).toBe(0);

    handle.dispose();
  });
});
