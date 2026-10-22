/*!
 * UprightLightChamber 2.0.0
 * Abstract standing-reference environment: a deep floor grid, tall light
 * columns, an overhead halo and slow rising motes. The geometry is built
 * around a 1.7 m eye line so a reclined patient reads the scene as upright.
 *
 * ES module; no globals. Contract is the same as the other scenes:
 *   createWorld(THREE, { quality, eyeHeight }) ->
 *   { scene, world, update(dt), selectables, dispose }
 */
var VERSION = '2.0.0';

export function createWorld(THREE, options) {
  var quality = options && options.quality === 'low' ? 'low' : 'high';
  var eyeHeight = options && options.eyeHeight ? options.eyeHeight : 1.7;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07100f);
  scene.fog = new THREE.Fog(0x07100f, 8, 26);

  var world = new THREE.Group();
  world.name = 'upright-light-chamber';
  scene.add(world);

  var selectables = [];
  var gold = 0xe0bb78;
  var teal = 0x7fc8b8;

  // Floor: a deep disc plus grid so the eye line reads as standing height.
  var floor = new THREE.Mesh(
    new THREE.CircleGeometry(10, quality === 'high' ? 72 : 40),
    new THREE.MeshStandardMaterial({
      color: 0x0c1a18,
      roughness: 0.94,
      metalness: 0.06
    })
  );
  floor.rotation.x = -Math.PI / 2;
  world.add(floor);

  var grid = new THREE.GridHelper(20, quality === 'high' ? 40 : 20, 0x2b4a44, 0x19302b);
  grid.position.y = 0.006;
  grid.material.transparent = true;
  grid.material.opacity = 0.42;
  world.add(grid);

  // Three slow rings on the floor: optic flow around the vertical axis.
  var ringMaterial = new THREE.MeshBasicMaterial({
    color: teal,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  var floorRings = [];
  var ringRadii = [2.4, 4.1, 6.2];
  for (var r = 0; r < ringRadii.length; r++) {
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(ringRadii[r], ringRadii[r] + 0.03, quality === 'high' ? 96 : 48),
      ringMaterial
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012 + r * 0.001;
    world.add(ring);
    floorRings.push(ring);
  }

  // Footprint: a gold anchor directly under the patient.
  var footprint = new THREE.Mesh(
    new THREE.RingGeometry(0.46, 0.54, 48),
    new THREE.MeshBasicMaterial({
      color: gold,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  footprint.rotation.x = -Math.PI / 2;
  footprint.position.y = 0.018;
  world.add(footprint);

  // Tall columns: instanced so eight vertical references cost one draw call.
  var columnGeometry = new THREE.BoxGeometry(0.16, 7, 0.16);
  var columnMaterial = new THREE.MeshStandardMaterial({
    color: 0x122522,
    roughness: 0.58,
    metalness: 0.2,
    emissive: 0x17352f,
    emissiveIntensity: 0.55
  });
  var columnCount = 8;
  var columns = new THREE.InstancedMesh(columnGeometry, columnMaterial, columnCount);
  columns.name = 'chamber-columns';
  var stripGeometry = new THREE.BoxGeometry(0.025, 6.4, 0.025);
  var stripMaterial = new THREE.MeshBasicMaterial({
    color: teal,
    transparent: true,
    opacity: 0.5,
    toneMapped: false
  });
  var strips = new THREE.InstancedMesh(stripGeometry, stripMaterial, columnCount);
  strips.name = 'chamber-strips';
  var dummy = new THREE.Object3D();
  for (var c = 0; c < columnCount; c++) {
    var angle = (c / columnCount) * Math.PI * 2 + Math.PI / 8;
    var cx = Math.cos(angle) * 5.2;
    var cz = Math.sin(angle) * 5.2;
    dummy.position.set(cx, 3.5, cz);
    dummy.rotation.set(0, -angle, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    columns.setMatrixAt(c, dummy.matrix);
    dummy.position.set(cx, 3.4, cz);
    dummy.updateMatrix();
    strips.setMatrixAt(c, dummy.matrix);
  }
  columns.instanceMatrix.needsUpdate = true;
  strips.instanceMatrix.needsUpdate = true;
  world.add(columns);
  world.add(strips);

  // Overhead halo: the ceiling reference that makes the columns feel tall.
  var halo = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.045, 8, 96),
    new THREE.MeshBasicMaterial({
      color: gold,
      transparent: true,
      opacity: 0.55,
      toneMapped: false
    })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 6.6;
  world.add(halo);

  // A faint vertical shaft joins floor and halo. In stereo it gives the eye a
  // single absolute vertical to judge posture against.
  var beamMaterial = new THREE.MeshBasicMaterial({
    color: teal,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  var beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 6.6, 24, 1, true),
    beamMaterial
  );
  beam.position.y = 3.3;
  world.add(beam);

  // Hanging filaments tie the halo to the floor without adding draw calls.
  var filamentCount = quality === 'high' ? 12 : 8;
  var filamentGeometry = new THREE.CylinderGeometry(0.006, 0.006, 1.7, 5);
  var filamentMaterial = new THREE.MeshBasicMaterial({
    color: teal,
    transparent: true,
    opacity: 0.24,
    toneMapped: false
  });
  var filaments = new THREE.InstancedMesh(filamentGeometry, filamentMaterial, filamentCount);
  filaments.name = 'chamber-filaments';
  for (var f = 0; f < filamentCount; f++) {
    var fa = (f / filamentCount) * Math.PI * 2;
    dummy.position.set(Math.cos(fa) * 3.4, 5.7, Math.sin(fa) * 3.4);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    filaments.setMatrixAt(f, dummy.matrix);
  }
  filaments.instanceMatrix.needsUpdate = true;
  world.add(filaments);

  // Motes rise slowly: vertical optic flow is the clearest standing cue.
  // One sphere geometry serves both layers; instance scale carries the size.
  var moteGeometry = new THREE.SphereGeometry(0.014, 6, 6);
  var warmMotes = new THREE.InstancedMesh(
    moteGeometry,
    new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.8, toneMapped: false }),
    quality === 'high' ? 64 : 36
  );
  var coolMotes = new THREE.InstancedMesh(
    moteGeometry,
    new THREE.MeshBasicMaterial({ color: teal, transparent: true, opacity: 0.62, toneMapped: false }),
    quality === 'high' ? 32 : 18
  );
  warmMotes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coolMotes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Instance matrices change every frame; a stale bounding sphere would cull
  // motes that are actually in view, so skip frustum culling for these layers.
  warmMotes.frustumCulled = false;
  coolMotes.frustumCulled = false;
  warmMotes.name = 'chamber-motes-warm';
  coolMotes.name = 'chamber-motes-cool';

  function makeMotes(count) {
    var list = [];
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var radius = 0.6 + Math.random() * 4.2;
      list.push({
        x: Math.cos(a) * radius,
        z: Math.sin(a) * radius,
        offset: Math.random() * 6.6,
        speed: 0.08 + Math.random() * 0.1,
        sway: 0.1 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        size: 0.7 + Math.random() * 0.8
      });
    }
    return list;
  }
  var warmMoteData = makeMotes(warmMotes.count);
  var coolMoteData = makeMotes(coolMotes.count);
  world.add(warmMotes);
  world.add(coolMotes);

  // Near-field dust moves across the stereo baseline as the head turns; this
  // is the depth cue a flat room cannot give.
  var nearMotes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.02, 6, 6),
    new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.55, toneMapped: false }),
    quality === 'high' ? 18 : 10
  );
  nearMotes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nearMotes.frustumCulled = false;
  nearMotes.name = 'chamber-motes-near';
  var nearMoteData = [];
  for (var n = 0; n < nearMotes.count; n++) {
    var na = Math.random() * Math.PI * 2;
    nearMoteData.push({
      x: Math.cos(na) * (0.7 + Math.random() * 0.9),
      z: Math.sin(na) * (0.7 + Math.random() * 0.9),
      offset: 0.9 + Math.random() * 1.4,
      speed: 0.02 + Math.random() * 0.03,
      sway: 0.05 + Math.random() * 0.1,
      phase: Math.random() * Math.PI * 2,
      size: 0.8 + Math.random() * 0.6
    });
  }
  world.add(nearMotes);

  // Three monoliths are the scene's gaze targets; they also mark mid-depth.
  var monolithGeometry = new THREE.BoxGeometry(0.22, 1.25, 0.22);
  var monolithMaterial = new THREE.MeshStandardMaterial({
    color: 0x24413a,
    roughness: 0.5,
    metalness: 0.25,
    emissive: 0x1b4a40,
    emissiveIntensity: 0.5
  });
  var monolithHaloMaterial = new THREE.MeshBasicMaterial({
    color: teal,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false
  });
  var monolithHalos = new THREE.InstancedMesh(
    new THREE.TorusGeometry(0.26, 0.009, 6, 40),
    monolithHaloMaterial,
    3
  );
  monolithHalos.name = 'chamber-target-halos';
  world.add(monolithHalos);
  var monolithLabels = ['monolith-a', 'monolith-b', 'monolith-c'];
  for (var m = 0; m < 3; m++) {
    var ma = (m / 3) * Math.PI * 2 - Math.PI / 2;
    var mx = Math.cos(ma) * 3.1;
    var mz = Math.sin(ma) * 3.1;
    var monolith = new THREE.Mesh(monolithGeometry, monolithMaterial);
    monolith.position.set(mx, 0.625, mz);
    monolith.rotation.y = -ma;
    monolith.userData.selectable = true;
    monolith.userData.targetId = m + 1;
    monolith.userData.label = monolithLabels[m];
    world.add(monolith);
    selectables.push(monolith);
    dummy.position.set(mx, 1.36, mz);
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    monolithHalos.setMatrixAt(m, dummy.matrix);
  }
  monolithHalos.instanceMatrix.needsUpdate = true;

  // Lights belong to the world group (not the carrier scene) so they are
  // counted by the stats walk, re-parented with the handle and released on
  // dispose. The carrier scene only owns background and fog.
  var hemi = new THREE.HemisphereLight(0x9fd8ca, 0x08100f, 0.72);
  world.add(hemi);
  var warm = new THREE.PointLight(0xffd9a0, 0.75, 12, 2);
  warm.position.set(0, 4.8, 0);
  world.add(warm);
  var cool = new THREE.PointLight(0x66ccff, 0.45, 12, 2);
  cool.position.set(-3.4, 2.2, -3.0);
  world.add(cool);

  var elapsed = 0;
  var disposed = false;

  function update(dt) {
    if (disposed) {
      return;
    }
    var step = typeof dt === 'number' && isFinite(dt) && dt > 0 ? dt : 0;
    if (step > 0.1) {
      step = 0.1;
    }
    elapsed += step;

    for (var r = 0; r < floorRings.length; r++) {
      floorRings[r].rotation.z += step * (0.02 + r * 0.008);
    }
    halo.rotation.z += step * 0.04;
    footprint.rotation.z -= step * 0.12;

    var pulse = 0.42 + 0.16 * Math.sin(elapsed * 0.55);
    stripMaterial.opacity = pulse;
    filamentMaterial.opacity = 0.18 + 0.08 * Math.sin(elapsed * 0.4 + 1.3);
    beamMaterial.opacity = 0.045 + 0.03 * Math.sin(elapsed * 0.35);
    monolithHaloMaterial.opacity = 0.28 + 0.2 * Math.sin(elapsed * 0.8);

    updateMotes(warmMotes, warmMoteData, elapsed);
    updateMotes(coolMotes, coolMoteData, elapsed + 2.1);
    updateMotes(nearMotes, nearMoteData, elapsed + 0.7);
  }

  function updateMotes(mesh, data, time) {
    for (var i = 0; i < data.length; i++) {
      var mote = data[i];
      var y = 0.4 + ((mote.offset + time * mote.speed) % 6.6);
      dummy.position.set(
        mote.x + Math.sin(time * 0.25 + mote.phase) * mote.sway,
        y,
        mote.z + Math.cos(time * 0.2 + mote.phase) * mote.sway
      );
      dummy.scale.setScalar(mote.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  var textures = 0;
  var meshes = 0;
  var drawCalls = 0;
  var triangles = 0;
  var lights = 0;
  var seenTextures = [];
  world.traverse(function (object) {
    if (object.isLight) {
      lights++;
      return;
    }
    var isMesh = object.isMesh === true;
    if (!isMesh && object.isLine !== true) {
      return;
    }
    // Line helpers (the floor grid) cost a draw call but no triangles.
    drawCalls++;
    if (isMesh) {
      meshes++;
      var geometry = object.geometry;
      if (geometry) {
        var instances = object.isInstancedMesh ? object.count : 1;
        if (geometry.index) {
          triangles += (geometry.index.count / 3) * instances;
        } else if (geometry.attributes && geometry.attributes.position) {
          triangles += (geometry.attributes.position.count / 3) * instances;
        }
      }
    }
    var list = object.material
      ? (Array.isArray(object.material) ? object.material : [object.material])
      : [];
    for (var i = 0; i < list.length; i++) {
      var map = list[i] ? list[i].map : null;
      if (map && seenTextures.indexOf(map) === -1) {
        seenTextures.push(map);
        textures++;
      }
    }
  });
  world.userData.stats = {
    triangles: Math.round(triangles),
    drawCalls: drawCalls,
    meshes: meshes,
    lights: lights,
    textures: textures,
    quality: quality
  };
  world.userData.eyeHeight = eyeHeight;

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    var ownedTextures = [];
    var ownedMaterials = [];
    var ownedGeometries = [];
    world.traverse(function (object) {
      if (object.geometry && ownedGeometries.indexOf(object.geometry) === -1) {
        ownedGeometries.push(object.geometry);
      }
      var list = object.material
        ? (Array.isArray(object.material) ? object.material : [object.material])
        : [];
      for (var i = 0; i < list.length; i++) {
        var material = list[i];
        if (!material || ownedMaterials.indexOf(material) !== -1) {
          continue;
        }
        ownedMaterials.push(material);
        if (material.map && ownedTextures.indexOf(material.map) === -1) {
          ownedTextures.push(material.map);
        }
      }
    });
    for (var t = 0; t < ownedTextures.length; t++) {
      ownedTextures[t].dispose();
    }
    for (var mt = 0; mt < ownedMaterials.length; mt++) {
      ownedMaterials[mt].dispose();
    }
    for (var g = 0; g < ownedGeometries.length; g++) {
      ownedGeometries[g].dispose();
    }
    while (world.children.length) {
      world.remove(world.children[0]);
    }
    scene.remove(world);
    selectables.length = 0;
  }

  // Prime the first frame so no mote sits at the origin.
  update(0);

  return {
    scene: scene,
    world: world,
    update: update,
    selectables: selectables,
    dispose: dispose
  };
}

export { VERSION };
