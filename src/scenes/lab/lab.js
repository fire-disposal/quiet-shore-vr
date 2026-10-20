/*!
 * SpatialLabScene 1.0.0
 * Abstract calibration stage for the four spatial UI modes. The actual
 * panels live in src/ui/spatial-lab.ts; this scene only provides a quiet,
 * low-cost environment, a floor grid and three gaze targets.
 *
 * ES module; no globals. Contract is the same as the other scenes:
 *   createWorld(THREE, { quality, eyeHeight }) ->
 *   { scene, world, update(dt), selectables, dispose }
 */
var VERSION = '1.0.0';

export function createWorld(THREE, options) {
  var quality = options && options.quality === 'low' ? 'low' : 'high';
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070d0c);
  scene.fog = new THREE.Fog(0x070d0c, 7, 22);

  var world = new THREE.Group();
  world.name = 'spatial-lab';
  scene.add(world);

  var selectables = [];

  var floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, quality === 'high' ? 80 : 48),
    new THREE.MeshStandardMaterial({
      color: 0x0b1715,
      roughness: 0.92,
      metalness: 0.08
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  world.add(floor);

  var grid = new THREE.GridHelper(7.2, quality === 'high' ? 32 : 16, 0x2e4a45, 0x1b2e2a);
  grid.position.y = 0.006;
  if (grid.material) {
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
  }
  world.add(grid);

  var ring = new THREE.Mesh(
    new THREE.RingGeometry(1.42, 1.52, quality === 'high' ? 72 : 40),
    new THREE.MeshBasicMaterial({
      color: 0xe0bb78,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  world.add(ring);

  var marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.02, 32),
    new THREE.MeshStandardMaterial({
      color: 0xe0bb78,
      roughness: 0.35,
      metalness: 0.4,
      emissive: 0x5a431a,
      emissiveIntensity: 0.35
    })
  );
  marker.position.y = 0.02;
  marker.userData.selectable = true;
  world.add(marker);
  selectables.push(marker);

  var pillarGeometry = new THREE.BoxGeometry(0.12, 1.8, 0.12);
  var pillarMaterial = new THREE.MeshStandardMaterial({
    color: 0x12211e,
    roughness: 0.55,
    metalness: 0.25,
    emissive: 0x17352f,
    emissiveIntensity: 0.5
  });
  var positions = [
    [-2.6, 0.9, -2.2],
    [2.6, 0.9, -2.2],
    [-2.6, 0.9, 2.2],
    [2.6, 0.9, 2.2]
  ];
  for (var i = 0; i < positions.length; i++) {
    var pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(positions[i][0], positions[i][1], positions[i][2]);
    world.add(pillar);
    if (i < 2) {
      pillar.userData.selectable = true;
      selectables.push(pillar);
    }
  }

  var horizon = new THREE.Mesh(
    new THREE.RingGeometry(4.8, 5.2, quality === 'high' ? 72 : 40),
    new THREE.MeshBasicMaterial({
      color: 0x7fc8b8,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  horizon.rotation.x = -Math.PI / 2;
  horizon.position.y = 0.004;
  world.add(horizon);

  var hemi = new THREE.HemisphereLight(0x9fd8ca, 0x0a1211, 0.75);
  scene.add(hemi);
  var warm = new THREE.PointLight(0xffd9a0, 0.85, 9, 2);
  warm.position.set(0, 2.6, 0.2);
  scene.add(warm);
  var cool = new THREE.PointLight(0x66ccff, 0.5, 9, 2);
  cool.position.set(-2.2, 1.8, -2.0);
  scene.add(cool);

  var elapsed = 0;
  function update(dt) {
    var step = typeof dt === 'number' && isFinite(dt) && dt > 0 ? dt : 0;
    elapsed += step;
    marker.rotation.y += step * 0.35;
    ring.rotation.z += step * 0.025;
  }

  var geometries = 0;
  var materials = 0;
  var textures = 0;
  var meshes = 0;
  var triangles = 0;
  var seenMaterials = [];
  var seenTextures = [];
  world.traverse(function (object) {
    if (!object.isMesh) {
      return;
    }
    meshes++;
    var geometry = object.geometry;
    if (geometry) {
      geometries++;
      if (geometry.index) {
        triangles += geometry.index.count / 3;
      } else if (geometry.attributes.position) {
        triangles += geometry.attributes.position.count / 3;
      }
    }
    var list = object.material
      ? (Array.isArray(object.material) ? object.material : [object.material])
      : [];
    for (var m = 0; m < list.length; m++) {
      if (seenMaterials.indexOf(list[m]) === -1) {
        seenMaterials.push(list[m]);
        materials++;
        if (list[m].map && seenTextures.indexOf(list[m].map) === -1) {
          seenTextures.push(list[m].map);
          textures++;
        }
      }
    }
  });
  world.userData.stats = {
    triangles: Math.round(triangles),
    drawCalls: meshes,
    meshes: meshes,
    lights: 3,
    textures: textures,
    quality: quality
  };
  world.userData.eyeHeight = options && options.eyeHeight ? options.eyeHeight : 1.6;

  function dispose() {
    world.traverse(function (object) {
      if (object.geometry) {
        object.geometry.dispose();
      }
      var list = object.material
        ? (Array.isArray(object.material) ? object.material : [object.material])
        : [];
      for (var m = 0; m < list.length; m++) {
        list[m].dispose();
      }
    });
    while (world.children.length) {
      world.remove(world.children[0]);
    }
    scene.remove(world);
    selectables.length = 0;
  }

  return {
    scene: scene,
    world: world,
    update: update,
    selectables: selectables,
    dispose: dispose
  };
}

export { VERSION };
