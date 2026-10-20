/*!
 * LandscapeScene 3.0.0
 * Procedural lake-at-sunrise scene for Three.js r128 (PICO G2 4K / Adreno 540).
 *
 * Plain script: no modules, ES5 syntax. Exposes window.LandscapeScene.
 * Same contract as WardScene:
 *   createWorld(THREE, { quality, eyeHeight }) ->
 *   { scene, world, update(dt), selectables, dispose }
 *
 * High tier: heightfield terrain (vertex colours), shader sky dome, fresnel
 * water with analytic ripples, foam ribbon, layered ridges/haze, instanced
 * grass/flowers/reeds/pebbles/rocks, mixed conifer + broadleaf trees, detailed
 * pier, clouds and birds. 21 draw calls, ~34 k triangles, no shadow maps,
 * no postprocessing, no per-frame allocations.
 *
 * Camera far plane in main.ts is 100 m, so every distant layer stays inside
 * that distance; the sky dome radius is 90 m.
 */
(function (root) {
  'use strict';

  var VERSION = '3.0.0';
  var SHORE_Z = -2.5;
  var SKY_RADIUS = 90;

  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function canvasTexture(THREE, width, height, paint, repeatX, repeatY) {
    if (typeof document === 'undefined' || !document.createElement) {
      return null;
    }
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    paint(ctx, width, height);
    var texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    if (repeatX || repeatY) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX || 1, repeatY || 1);
    } else {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    return texture;
  }

  function createWorld(THREE, opts) {
    if (!THREE) {
      throw new Error('LandscapeScene.createWorld: THREE is required');
    }
    opts = opts || {};
    var quality = opts.quality === 'low' ? 'low' : 'high';
    var eyeHeight = typeof opts.eyeHeight === 'number' ? opts.eyeHeight : 1.6;
    var low = quality === 'low';
    var rnd = seeded(0x57a1c3);

    var TERRAIN_SEG = low ? 48 : 96;
    var coniferCount = low ? 8 : 24;
    var broadleafCount = low ? 6 : 18;
    var grassCount = low ? 380 : 1000;
    var flowerCount = low ? 60 : 160;
    var reedCount = low ? 35 : 90;
    var pebbleCount = low ? 50 : 160;
    var rockCount = low ? 8 : 24;
    var plankCount = low ? 8 : 14;
    var postCount = low ? 4 : 7;
    var cloudCount = low ? 4 : 10;
    var hazeCount = low ? 3 : 5;
    var birdCount = low ? 5 : 14;
    var ridgeCount = 6;
    var treeLineCount = low ? 14 : 40;
    var headlandCount = low ? 2 : 4;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbcd6ea);
    scene.fog = new THREE.Fog(0xc9d9e4, 50, 132);

    var world = new THREE.Group();
    scene.add(world);

    world.add(new THREE.HemisphereLight(0xd8eaff, 0x40502f, 0.8));
    var sunLight = new THREE.DirectionalLight(0xffe0b4, 1.05);
    sunLight.position.set(32, 38, 18);
    world.add(sunLight);

    var sunDir = new THREE.Vector3(-0.26, 0.17, -0.95).normalize();

    /* ------------------------------------------------------------------ *
     * World-locked sky dome: gradient, warm sun disk and horizon haze.
     * ------------------------------------------------------------------ */

    var skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x24578c) },
        uHorizon: { value: new THREE.Color(0xecd2ab) },
        uSun: { value: new THREE.Color(0xfff2d0) },
        uSunDir: { value: sunDir }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uTop;',
        'uniform vec3 uHorizon;',
        'uniform vec3 uSun;',
        'uniform vec3 uSunDir;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float up = clamp(d.y, 0.0, 1.0);',
        '  vec3 col = mix(uHorizon, uTop, pow(up, 0.62));',
        '  float band = exp(-max(d.y, 0.0) * 8.0);',
        '  col = mix(col, uHorizon, band * 0.42);',
        '  float s = max(dot(d, normalize(uSunDir)), 0.0);',
        '  col += uSun * (pow(s, 1400.0) * 2.2 + pow(s, 22.0) * 0.30 + pow(s, 4.0) * 0.07);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    var skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, low ? 24 : 48, low ? 14 : 24),
      skyMaterial
    );
    skyDome.name = 'sky-dome';
    skyDome.renderOrder = -10;
    skyDome.frustumCulled = false;
    world.add(skyDome);

    /* ------------------------------------------------------------------ *
     * Heightfield terrain with baked vertex colours.
     * ------------------------------------------------------------------ */

    function terrainHeight(x, z) {
      var h = 0;
      var side = Math.max(0, Math.abs(x) - 20);
      h += Math.min(side * 0.34, 10);
      var back = Math.max(0, -z - 58);
      h += Math.min(back * 0.45, 24);
      var behind = Math.max(0, z - 12);
      h += Math.min(behind * 0.22, 5);
      var land = Math.min(1, (side + back + behind) / 7);
      if (land > 0) {
        h += (Math.sin(x * 0.1) * Math.cos(z * 0.085) +
          0.55 * Math.sin(x * 0.047 + z * 0.12)) * 1.5 * land;
      }
      return h;
    }

    var terrainGeo = new THREE.PlaneGeometry(260, 260, TERRAIN_SEG, TERRAIN_SEG);
    terrainGeo.rotateX(-Math.PI / 2);
    var tPos = terrainGeo.attributes.position;
    var tColors = new Float32Array(tPos.count * 3);
    var sand = new THREE.Color(0xb39a70);
    var grassLow = new THREE.Color(0x456a33);
    var grassHigh = new THREE.Color(0x5f7c45);
    var rockTint = new THREE.Color(0x6f735e);
    var tmpColor = new THREE.Color();
    var ti;
    for (ti = 0; ti < tPos.count; ti++) {
      var tx = tPos.getX(ti);
      var tz = tPos.getZ(ti);
      var th = terrainHeight(tx, tz);
      tPos.setY(ti, th);

      var moisture = 0.5 + 0.5 * Math.sin(tx * 0.19) * Math.cos(tz * 0.16);
      tmpColor.copy(grassLow).lerp(grassHigh, moisture * 0.75 + Math.min(th, 8) * 0.02);

      if (tz > SHORE_Z + 0.9 && tz < SHORE_Z + 2.2 && Math.abs(tx) < 34) {
        var beach = 1 - Math.abs((tz - SHORE_Z - 1.55) / 0.65);
        tmpColor.lerp(sand, Math.max(0, Math.min(1, beach)) * 0.8);
      }
      if (th > 5) {
        tmpColor.lerp(rockTint, Math.min(1, (th - 5) / 16) * 0.55);
      }
      tColors[ti * 3] = tmpColor.r;
      tColors[ti * 3 + 1] = tmpColor.g;
      tColors[ti * 3 + 2] = tmpColor.b;
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
    terrainGeo.computeVertexNormals();

    var terrain = new THREE.Mesh(
      terrainGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true })
    );
    terrain.name = 'terrain';
    world.add(terrain);

    /* ------------------------------------------------------------------ *
     * Water: fresnel, animated ripple normal, depth tint and sun specular.
     * ------------------------------------------------------------------ */

    var waterUniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x1d5c80) },
      uShallow: { value: new THREE.Color(0x67aec8) },
      uSky: { value: new THREE.Color(0xcfe6f4) },
      uSun: { value: new THREE.Color(0xffe3b6) },
      uSunDir: { value: sunDir },
      uFog: { value: new THREE.Color(0xc9d9e4) },
      uFogRange: { value: new THREE.Vector2(40, 110) }
    };
    var waterMaterial = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: [
        'varying vec3 vWorld;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorld = wp.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision mediump float;',
        'uniform float uTime;',
        'uniform vec3 uDeep;',
        'uniform vec3 uShallow;',
        'uniform vec3 uSky;',
        'uniform vec3 uSun;',
        'uniform vec3 uSunDir;',
        'uniform vec3 uFog;',
        'uniform vec2 uFogRange;',
        'varying vec3 vWorld;',
        'void main() {',
        '  vec2 p = vWorld.xz;',
        '  float dist = length(cameraPosition - vWorld);',
        '  float detail = 1.0 - smoothstep(14.0, 70.0, dist);',
        '  float w = sin(p.x * 0.62 + uTime * 0.85) * sin(p.y * 0.46 - uTime * 0.58);',
        '  w += 0.22 * sin(p.x * 0.23 - p.y * 0.37 + uTime * 0.41);',
        '  w += 0.5 * sin(p.x * 1.85 - p.y * 1.35 + uTime * 1.35) * detail;',
        '  w += 0.3 * sin(p.x * 4.1 + p.y * 3.2 - uTime * 2.05) * detail * detail;',
        '  vec3 n = normalize(vec3(w * 0.030, 1.0, w * 0.026));',
        '  vec3 viewDir = normalize(cameraPosition - vWorld);',
        '  float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);',
        '  float shore = smoothstep(-46.0, -4.0, vWorld.z);',
        '  vec3 base = mix(uDeep, uShallow, shore * 0.78);',
        '  vec3 col = mix(base, uSky, fres * 0.58);',
        '  vec3 halfDir = normalize(normalize(uSunDir) + viewDir);',
        '  float spec = pow(max(dot(n, halfDir), 0.0), 90.0) * (0.55 + 0.45 * detail);',
        '  col += uSun * spec * 1.35;',
        '  col = mix(col, uFog, smoothstep(uFogRange.x, uFogRange.y, dist));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    var water = new THREE.Mesh(new THREE.PlaneGeometry(130, 52), waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.05, SHORE_Z - 26);
    water.name = 'water';
    world.add(water);

    var foamTex = canvasTexture(THREE, 1024, 64, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (var i = 0; i < 220; i++) {
        var y = h * 0.35 + rnd() * h * 0.5;
        var x = rnd() * w;
        var len = 8 + rnd() * 34;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.12 + rnd() * 0.5) + ')';
        ctx.lineWidth = 0.8 + rnd() * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + len * 0.5, y + (rnd() - 0.5) * 5, x + len, y + (rnd() - 0.5) * 3);
        ctx.stroke();
      }
    }, 1, 1);
    var foam = new THREE.Mesh(
      new THREE.PlaneGeometry(88, 1.1),
      new THREE.MeshBasicMaterial({
        map: foamTex,
        color: 0xf4fbff,
        transparent: true,
        opacity: 0.42,
        depthWrite: false
      })
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, 0.075, SHORE_Z - 0.15);
    foam.renderOrder = 3;
    foam.name = 'foam';
    world.add(foam);

    /* ------------------------------------------------------------------ *
     * Distant layers: six ridges, a dense tree line and low green banks.
     * Cone geometry + per-instance colour keeps this to one draw call.
     * ------------------------------------------------------------------ */

    var coneGeo = new THREE.ConeGeometry(1, 1, 8, 1, true);
    var silhouetteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var silhouetteCount = ridgeCount + treeLineCount + headlandCount;
    var silhouettes = new THREE.InstancedMesh(coneGeo, silhouetteMat, silhouetteCount);
    silhouettes.frustumCulled = false;
    silhouettes.name = 'ridges';

    var dummy = new THREE.Object3D();
    var tint = new THREE.Color();
    var si;

    var ridges = [
      [-52, -78, 16, 24, 0x3f5a6e],
      [-26, -84, 13, 21, 0x486679],
      [0, -86, 18, 27, 0x3b566b],
      [28, -82, 14, 22, 0x4d6c80],
      [54, -76, 15, 23, 0x58778b],
      [78, -70, 12, 18, 0x647f92]
    ];
    for (si = 0; si < ridgeCount; si++) {
      var ridge = ridges[si];
      var rBase = terrainHeight(ridge[0], ridge[1]);
      dummy.position.set(ridge[0], rBase + ridge[3] * 0.5, ridge[1]);
      dummy.rotation.set(0, si * 0.62, 0);
      dummy.scale.set(ridge[2], ridge[3], ridge[2]);
      dummy.updateMatrix();
      silhouettes.setMatrixAt(si, dummy.matrix);
      silhouettes.setColorAt(si, tint.setHex(ridge[4]));
    }
    for (si = 0; si < treeLineCount; si++) {
      var lx = -52 + si * (104 / Math.max(treeLineCount - 1, 1)) + (rnd() - 0.5) * 2.4;
      var lz = -57 - rnd() * 6;
      var lr = 1.5 + rnd() * 1.1;
      var lh = 3.0 + rnd() * 3.2;
      var lBase = terrainHeight(lx, lz);
      dummy.position.set(lx, lBase + lh * 0.5, lz);
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.set(lr, lh, lr);
      dummy.updateMatrix();
      silhouettes.setMatrixAt(ridgeCount + si, dummy.matrix);
      silhouettes.setColorAt(
        ridgeCount + si,
        tint.setHex(si % 3 === 0 ? 0x35534b : (si % 3 === 1 ? 0x3d5d52 : 0x2f4c46))
      );
    }

    var headlandDefs = [
      [-9.5, -11, 5.8, 1.35, 0x4f6d4a],
      [9.5, -12, 6.2, 1.5, 0x55724d],
      [-16.5, -17, 7.4, 1.8, 0x486545],
      [17.5, -20, 8.2, 2.0, 0x4c6a48]
    ];
    var headlandBase = ridgeCount + treeLineCount;
    for (si = 0; si < headlandCount; si++) {
      var hl = headlandDefs[si];
      dummy.position.set(hl[0], hl[3] * 0.5, hl[1]);
      dummy.rotation.set(0, si * 1.1, 0);
      dummy.scale.set(hl[2], hl[3], hl[2]);
      dummy.updateMatrix();
      silhouettes.setMatrixAt(headlandBase + si, dummy.matrix);
      silhouettes.setColorAt(headlandBase + si, tint.setHex(hl[4]));
    }
    silhouettes.instanceMatrix.needsUpdate = true;
    if (silhouettes.instanceColor) {
      silhouettes.instanceColor.needsUpdate = true;
    }
    world.add(silhouettes);

    /* ------------------------------------------------------------------ *
     * Trees: shared trunks, layered conifer crowns, broadleaf canopies.
     * ------------------------------------------------------------------ */

    var treeTotal = coniferCount + broadleafCount;
    var trunkGeo = new THREE.CylinderGeometry(0.06, 0.16, 1.0, 5, 1, true);
    var trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a30 });
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeTotal);
    trunks.frustumCulled = false;

    /* Unit cone with hard facets; each tier is scaled independently. */
    var crownGeo = new THREE.ConeGeometry(1, 1, 6, 1, true).toNonIndexed();
    crownGeo.computeVertexNormals();
    var crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var crowns = new THREE.InstancedMesh(crownGeo, crownMat, coniferCount * 3);
    crowns.frustumCulled = false;

    var canopyGeo = new THREE.IcosahedronGeometry(1, low ? 0 : 1);
    canopyGeo.computeVertexNormals();
    var canopyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, broadleafCount * 3);
    canopies.frustumCulled = false;

    var coniferSpots = [
      [-7.6, -7.2], [-9.4, -9.4], [-11.2, -8.0],
      [-8.4, -11.6], [-12.8, -11.0], [-10.6, -6.2],
      [7.8, -7.8], [9.6, -10.2], [11.4, -8.6],
      [8.6, -12.0], [13.0, -11.4], [10.8, -6.6],
      [-27, -12], [-32, -22], [-38, -34], [26, -14],
      [31, -24], [37, -36], [-45, -48], [44, -50],
      [-55, -60], [55, -62], [-24, 14], [28, 16]
    ];
    /* Tier offsets/radii/heights in tree-local units (trunk is 1 unit tall). */
    var coniferTiers = [
      [1.55, 0.98, 2.05],
      [2.38, 0.76, 1.72],
      [3.10, 0.52, 1.38]
    ];
    var coniferColors = [0x2f6b3e, 0x347040, 0x296236];

    /* Broadleaf crown: three offset blobs, lowest and widest first. */
    var broadleafBlobs = [
      [-0.58, 2.12, 0.05, 1.55, 1.18, 1.42],
      [0.58, 2.42, -0.18, 1.25, 1.02, 1.18],
      [0.02, 2.98, 0.22, 0.98, 0.86, 0.92]
    ];
    var broadleafColors = [0x3d7a45, 0x478648, 0x579046];

    var trunkIdx = 0;
    var coniferIdx = 0;
    var tier;
    for (si = 0; si < coniferCount; si++) {
      var cp = coniferSpots[si % coniferSpots.length];
      var cx = cp[0] + (rnd() - 0.5) * 1.2;
      var cz = cp[1] + (rnd() - 0.5) * 1.2;
      var cBase = terrainHeight(cx, cz);
      var cs = 0.9 + rnd() * 0.5;

      dummy.position.set(cx, cBase + 0.5 * cs, cz);
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.set(cs * 0.9, cs, cs * 0.9);
      dummy.updateMatrix();
      trunks.setMatrixAt(trunkIdx, dummy.matrix);
      trunkIdx++;

      for (tier = 0; tier < coniferTiers.length; tier++) {
        var ct = coniferTiers[tier];
        dummy.position.set(cx, cBase + ct[0] * cs, cz);
        dummy.rotation.set(0, tier * 0.85 + rnd() * 0.35, 0);
        dummy.scale.set(ct[1] * cs, ct[2] * cs, ct[1] * cs);
        dummy.updateMatrix();
        crowns.setMatrixAt(coniferIdx, dummy.matrix);
        crowns.setColorAt(coniferIdx, tint.setHex(coniferColors[(tier + si) % 3]));
        coniferIdx++;
      }
    }
    for (si = 0; si < broadleafCount; si++) {
      var side = si % 2 === 0 ? -1 : 1;
      var bx = side * (30 + rnd() * 22) + (rnd() - 0.5) * 4;
      var bz = -14 - rnd() * 46;
      var bBase = terrainHeight(bx, bz);
      var bs = 1.0 + rnd() * 0.6;

      dummy.position.set(bx, bBase + 0.85 * bs, bz);
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.set(bs, bs * 1.7, bs);
      dummy.updateMatrix();
      trunks.setMatrixAt(trunkIdx, dummy.matrix);
      trunkIdx++;

      for (tier = 0; tier < broadleafBlobs.length; tier++) {
        var bb = broadleafBlobs[tier];
        dummy.position.set(
          bx + bb[0] * bs,
          bBase + bb[1] * bs,
          bz + bb[2] * bs
        );
        dummy.rotation.set(rnd() * 0.4, rnd() * Math.PI, rnd() * 0.4);
        dummy.scale.set(bb[3] * bs, bb[4] * bs, bb[5] * bs);
        dummy.updateMatrix();
        canopies.setMatrixAt(si * 3 + tier, dummy.matrix);
        canopies.setColorAt(
          si * 3 + tier,
          tint.setHex(broadleafColors[(si + tier) % 3])
        );
      }
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) {
      crowns.instanceColor.needsUpdate = true;
    }
    if (canopies.instanceColor) {
      canopies.instanceColor.needsUpdate = true;
    }
    world.add(trunks);
    world.add(crowns);
    world.add(canopies);

    /* ------------------------------------------------------------------ *
     * Ground detail: grass tufts, flowers, reeds, pebbles and rocks.
     * ------------------------------------------------------------------ */

    function bladeTexture(ppp) {
      return canvasTexture(THREE, 64, 64, function (ctx, w, h) {
        ctx.clearRect(0, 0, w, h);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        for (var i = 0; i < ppp; i++) {
          var x = 5 + i * (w - 10) / (ppp - 1) + (rnd() - 0.5) * 3;
          var top = 5 + rnd() * 22;
          ctx.lineWidth = 1.3 + rnd() * 1.3;
          ctx.beginPath();
          ctx.moveTo(x, h - 2);
          ctx.quadraticCurveTo(
            x + (rnd() - 0.5) * 9,
            h * 0.45,
            x + (rnd() - 0.5) * 16,
            top
          );
          ctx.stroke();
        }
      });
    }

    var grassTex = bladeTexture(9);
    var grassGeo = new THREE.PlaneGeometry(0.55, 0.62);
    var grassMat = new THREE.MeshLambertMaterial({
      map: grassTex,
      color: 0xffffff,
      side: THREE.DoubleSide,
      alphaTest: 0.35
    });
    var grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
    grass.frustumCulled = false;
    for (si = 0; si < grassCount; si++) {
      var gx = (rnd() * 2 - 1) * 34;
      var gz = -1.8 + rnd() * 12;
      var gy = terrainHeight(gx, gz);
      var gs = 0.35 + rnd() * 0.45;
      dummy.position.set(gx, gy + 0.31 * gs, gz);
      dummy.rotation.set(0, rnd() * Math.PI, (rnd() - 0.5) * 0.22);
      dummy.scale.set(gs, gs, gs);
      dummy.updateMatrix();
      grass.setMatrixAt(si, dummy.matrix);
      grass.setColorAt(si, tint.setHex(si % 3 === 0 ? 0x5c7b3d : (si % 3 === 1 ? 0x6a8746 : 0x55703c)));
    }
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) {
      grass.instanceColor.needsUpdate = true;
    }
    world.add(grass);

    var flowerTex = canvasTexture(THREE, 64, 64, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      var colors = ['#fff3d6', '#f3c2d4', '#f2dc8c', '#e9f0d8'];
      for (var i = 0; i < 8; i++) {
        var x = 6 + rnd() * (w - 12);
        var y = 8 + rnd() * (h - 20);
        ctx.strokeStyle = 'rgba(120,150,90,0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, h - 2);
        ctx.lineTo(x + (rnd() - 0.5) * 3, y);
        ctx.stroke();
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.arc(x, y, 2 + rnd() * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    var flowerGeo = new THREE.PlaneGeometry(0.42, 0.42);
    var flowerMat = new THREE.MeshBasicMaterial({
      map: flowerTex,
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.3,
      depthWrite: false
    });
    var flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
    flowers.frustumCulled = false;
    for (si = 0; si < flowerCount; si++) {
      var fx = (rnd() * 2 - 1) * 30;
      var fz = -1.6 + rnd() * 6;
      var fs = 0.55 + rnd() * 0.5;
      dummy.position.set(fx, terrainHeight(fx, fz) + 0.21 * fs, fz);
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.set(fs, fs, fs);
      dummy.updateMatrix();
      flowers.setMatrixAt(si, dummy.matrix);
      flowers.setColorAt(si, tint.setHex(si % 3 === 0 ? 0xffffff : (si % 3 === 1 ? 0xffe6cf : 0xf6d9e4)));
    }
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) {
      flowers.instanceColor.needsUpdate = true;
    }
    world.add(flowers);

    var reedTex = bladeTexture(10);
    var reedGeo = new THREE.PlaneGeometry(0.5, 0.95);
    var reedMat = new THREE.MeshLambertMaterial({
      map: reedTex,
      color: 0xffffff,
      side: THREE.DoubleSide,
      alphaTest: 0.35
    });
    var reeds = new THREE.InstancedMesh(reedGeo, reedMat, reedCount);
    reeds.frustumCulled = false;
    for (si = 0; si < reedCount; si++) {
      var rx = -18 + (si / Math.max(reedCount - 1, 1)) * 36 + (rnd() - 0.5) * 1.6;
      if (rx > 0.8 && rx < 4.6) {
        rx += 5.0;
      }
      var rz = -2.1 - rnd() * 0.9;
      var rs = 0.55 + rnd() * 0.55;
      dummy.position.set(rx, 0.45 * rs, rz);
      dummy.rotation.set(0, rnd() * Math.PI, (rnd() - 0.5) * 0.2);
      dummy.scale.set(rs, rs, rs);
      dummy.updateMatrix();
      reeds.setMatrixAt(si, dummy.matrix);
      reeds.setColorAt(si, tint.setHex(si % 3 === 0 ? 0x5e7a40 : (si % 3 === 1 ? 0x6a8546 : 0x55703c)));
    }
    reeds.instanceMatrix.needsUpdate = true;
    if (reeds.instanceColor) {
      reeds.instanceColor.needsUpdate = true;
    }
    world.add(reeds);

    var pebbleGeo = new THREE.IcosahedronGeometry(0.16, 0);
    var pebbleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
    pebbles.frustumCulled = false;
    for (si = 0; si < pebbleCount; si++) {
      var px = -15 + (si / Math.max(pebbleCount - 1, 1)) * 30 + (rnd() - 0.5) * 2.0;
      if (px > 0.7 && px < 4.7) {
        px += 5.4;
      }
      var pz = SHORE_Z + 0.75 - rnd() * 0.55;
      var ps = 0.55 + rnd() * 1.0;
      dummy.position.set(px, terrainHeight(px, pz) + 0.05 * ps, pz);
      dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      dummy.scale.set(ps, ps * 0.55, ps * 0.8);
      dummy.updateMatrix();
      pebbles.setMatrixAt(si, dummy.matrix);
      pebbles.setColorAt(si, tint.setHex(si % 3 === 0 ? 0x777467 : (si % 3 === 1 ? 0x868273 : 0x6f7062)));
    }
    pebbles.instanceMatrix.needsUpdate = true;
    if (pebbles.instanceColor) {
      pebbles.instanceColor.needsUpdate = true;
    }
    world.add(pebbles);

    var rockGeo = new THREE.IcosahedronGeometry(0.55, 0);
    var rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    rocks.frustumCulled = false;
    for (si = 0; si < rockCount; si++) {
      var rkx = -16 + (si / Math.max(rockCount - 1, 1)) * 32 + (rnd() - 0.5) * 3;
      if (rkx > 0.4 && rkx < 5.0) {
        rkx += 6;
      }
      var rkz = -2.3 + rnd() * 1.6;
      var rks = 0.45 + rnd() * 0.5;
      dummy.position.set(rkx, terrainHeight(rkx, rkz) + 0.2 * rks, rkz);
      dummy.rotation.set(rnd() * 2, rnd() * 3, rnd() * 2);
      dummy.scale.set(rks, rks * 0.55, rks * 0.9);
      dummy.updateMatrix();
      rocks.setMatrixAt(si, dummy.matrix);
      rocks.setColorAt(si, tint.setHex(si % 2 === 0 ? 0x606a6d : 0x6b7476));
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) {
      rocks.instanceColor.needsUpdate = true;
    }
    world.add(rocks);

    /* ------------------------------------------------------------------ *
     * Pier with plank/post detail and a small warm lantern.
     * ------------------------------------------------------------------ */

    var boxGeo = new THREE.BoxGeometry(1, 1, 1);
    var woodMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var pier = new THREE.InstancedMesh(boxGeo, woodMat, plankCount + postCount * 2);
    pier.frustumCulled = false;
    var pierX = 2.5;
    var pierStep = 1.02;
    for (si = 0; si < plankCount; si++) {
      var ppz = -1.1 - si * pierStep;
      dummy.position.set(pierX, 0.2, ppz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1.4, 0.1, 0.95);
      dummy.updateMatrix();
      pier.setMatrixAt(si, dummy.matrix);
      pier.setColorAt(si, tint.setHex(si % 2 === 0 ? 0x7a5a3a : 0x715235));
    }
    for (si = 0; si < postCount * 2; si++) {
      var postZ = -1.1 - Math.floor(si / 2) * (pierStep * 2);
      var postX = pierX + (si % 2 === 0 ? -0.62 : 0.62);
      dummy.position.set(postX, 0.12, postZ);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.13, 1.3, 0.13);
      dummy.updateMatrix();
      pier.setMatrixAt(plankCount + si, dummy.matrix);
      pier.setColorAt(plankCount + si, tint.setHex(0x5f452c));
    }
    pier.instanceMatrix.needsUpdate = true;
    if (pier.instanceColor) {
      pier.instanceColor.needsUpdate = true;
    }
    world.add(pier);

    var lantern = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.34, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0xffd79a,
        emissive: 0xffb75a,
        emissiveIntensity: 0.9,
        roughness: 0.6
      })
    );
    lantern.position.set(pierX + 0.45, 0.9, -1.1 - (plankCount - 1) * pierStep);
    world.add(lantern);

    /* ------------------------------------------------------------------ *
     * Clouds, low mist and birds.
     * ------------------------------------------------------------------ */

    var cloudTex = canvasTexture(THREE, 256, 128, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < 16; i++) {
        var cx = 20 + rnd() * (w - 40);
        var cy = 42 + rnd() * 42;
        var radius = 18 + rnd() * 38;
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        g.addColorStop(0, 'rgba(255,255,255,' + (0.3 + rnd() * 0.35) + ')');
        g.addColorStop(0.5, 'rgba(255,251,242,' + (0.12 + rnd() * 0.16) + ')');
        g.addColorStop(1, 'rgba(255,250,240,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
    });
    var cloudMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: cloudTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        fog: false
      }),
      cloudCount
    );
    cloudMesh.renderOrder = 1;
    cloudMesh.frustumCulled = false;
    world.add(cloudMesh);

    var hazeTex = canvasTexture(THREE, 64, 32, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.52, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      var edge = ctx.createLinearGradient(0, 0, w, 0);
      edge.addColorStop(0, 'rgba(0,0,0,0)');
      edge.addColorStop(0.2, 'rgba(0,0,0,1)');
      edge.addColorStop(0.8, 'rgba(0,0,0,1)');
      edge.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    });
    var hazeMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: hazeTex,
        color: 0xeaf3fa,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        fog: false
      }),
      hazeCount
    );
    hazeMesh.renderOrder = 4;
    hazeMesh.frustumCulled = false;
    world.add(hazeMesh);

    var birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.9, 0, 0, -0.1, 0, 0, -0.45, 0.28, 0,
      0.1, 0, 0, 0.9, 0, 0, 0.45, 0.28, 0
    ], 3));
    birdGeo.computeVertexNormals();
    var birdMat = new THREE.MeshBasicMaterial({
      color: 0x2b3a44,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var birds = new THREE.InstancedMesh(birdGeo, birdMat, birdCount);
    birds.renderOrder = 5;
    birds.frustumCulled = false;
    world.add(birds);

    /* Per-instance animation state, allocated once. */
    var cloudBaseX = [];
    var cloudBaseY = [];
    var cloudBaseZ = [];
    var cloudW = [];
    var cloudH = [];
    var cloudTilt = [];
    var cloudPhase = [];
    var cloudDefs = [
      [-58, -74, 38, 12, 30], [-28, -86, 28, 9, 36],
      [2, -80, 46, 14, 26], [34, -88, 32, 10, 32],
      [58, -76, 26, 9, 38], [76, -70, 40, 12, 28],
      [-70, -82, 32, 10, 34], [18, -70, 24, 8, 40],
      [48, -68, 30, 10, 25], [-46, -66, 26, 9, 39]
    ];
    for (si = 0; si < cloudCount; si++) {
      var cd = cloudDefs[si % cloudDefs.length];
      cloudBaseX.push(cd[0]);
      cloudBaseZ.push(cd[1]);
      cloudW.push(cd[2]);
      cloudH.push(cd[3]);
      cloudBaseY.push(cd[4]);
      cloudTilt.push((rnd() - 0.5) * 0.1);
      cloudPhase.push(si * 1.7);
    }

    var hazeDefs = [
      [-62, 8.6, 26, 210], [-76, 9.6, 30, 210],
      [-88, 11.0, 34, 210], [-28, 1.5, 4.2, 90],
      [-44, 2.1, 5.0, 110]
    ];
    for (si = 0; si < hazeCount; si++) {
      var hd = hazeDefs[si % hazeDefs.length];
      dummy.position.set(0, hd[1], hd[0]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(hd[3], hd[2], 1);
      dummy.updateMatrix();
      hazeMesh.setMatrixAt(si, dummy.matrix);
    }
    hazeMesh.instanceMatrix.needsUpdate = true;

    var birdBaseX = [];
    var birdBaseY = [];
    var birdBaseZ = [];
    var birdScale = [];
    var birdSpeed = [];
    var birdPhase = [];
    for (si = 0; si < birdCount; si++) {
      birdBaseX.push(-22 + si * 3.6 + (rnd() - 0.5) * 3);
      birdBaseY.push(10 + rnd() * 9);
      birdBaseZ.push(-28 - rnd() * 34);
      birdScale.push(0.5 + rnd() * 0.5);
      birdSpeed.push(0.15 + rnd() * 0.12);
      birdPhase.push(rnd() * 6.28);
    }

    for (si = 0; si < cloudCount; si++) {
      dummy.position.set(cloudBaseX[si], cloudBaseY[si], cloudBaseZ[si]);
      dummy.rotation.set(0, 0, cloudTilt[si]);
      dummy.scale.set(cloudW[si], cloudH[si], 1);
      dummy.updateMatrix();
      cloudMesh.setMatrixAt(si, dummy.matrix);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;

    for (si = 0; si < birdCount; si++) {
      dummy.position.set(birdBaseX[si], birdBaseY[si], birdBaseZ[si]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(birdScale[si], birdScale[si], birdScale[si]);
      dummy.updateMatrix();
      birds.setMatrixAt(si, dummy.matrix);
    }
    birds.instanceMatrix.needsUpdate = true;

    /* ------------------------------------------------------------------ *
     * Gaze targets: three warm stones floating above the water.
     * ------------------------------------------------------------------ */

    var selectables = [];
    var orbColors = [0xffb347, 0x66ccff, 0x9be36b];
    var orbBase = [[-2.4, 1.05, -5.2], [0, 1.35, -6.4], [2.4, 1.05, -5.2]];
    var orbGeo = new THREE.IcosahedronGeometry(0.16, 0);
    for (si = 0; si < orbBase.length; si++) {
      var orb = new THREE.Mesh(
        orbGeo,
        new THREE.MeshStandardMaterial({
          color: orbColors[si],
          emissive: orbColors[si],
          emissiveIntensity: 0.6,
          roughness: 0.32,
          metalness: 0.1
        })
      );
      orb.position.set(orbBase[si][0], orbBase[si][1], orbBase[si][2]);
      orb.userData.selectable = true;
      orb.userData.label = 'lake-orb-' + (si + 1);
      orb.userData.baseY = orbBase[si][1];
      orb.userData.phase = si * 1.7;
      world.add(orb);
      selectables.push(orb);
    }

    /* ------------------------------------------------------------------ *
     * Animation: uniforms, texture offsets, instance matrices only.
     * ------------------------------------------------------------------ */

    var elapsed = 0;
    var i;

    function update(dt) {
      if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) {
        dt = 0;
      }
      if (dt > 0.1) {
        dt = 0.1;
      }
      elapsed += dt;
      waterUniforms.uTime.value = elapsed;

      if (foamTex) {
        foamTex.offset.x = (foamTex.offset.x + dt * 0.004) % 1;
      }

      for (i = 0; i < selectables.length; i++) {
        var orb = selectables[i];
        orb.position.y = orb.userData.baseY + Math.sin(elapsed * 1.05 + orb.userData.phase) * 0.05;
        /* No idle rotation: gaze-spin owns the selected target's orientation. */
      }

      for (i = 0; i < cloudCount; i++) {
        dummy.position.set(
          cloudBaseX[i] + Math.sin(elapsed * 0.014 + cloudPhase[i]) * 5,
          cloudBaseY[i],
          cloudBaseZ[i]
        );
        dummy.rotation.set(0, 0, cloudTilt[i]);
        dummy.scale.set(cloudW[i], cloudH[i], 1);
        dummy.updateMatrix();
        cloudMesh.setMatrixAt(i, dummy.matrix);
      }
      cloudMesh.instanceMatrix.needsUpdate = true;

      for (i = 0; i < birdCount; i++) {
        var t = elapsed * birdSpeed[i] + birdPhase[i];
        var flap = 0.55 + 0.5 * Math.abs(Math.sin(t * 2.4));
        dummy.position.set(
          birdBaseX[i] + Math.sin(t * 0.32) * 3.6,
          birdBaseY[i] + Math.sin(t * 1.5) * 0.55,
          birdBaseZ[i]
        );
        dummy.rotation.set(0, 0, Math.sin(t * 0.4) * 0.12);
        dummy.scale.set(birdScale[i], birdScale[i] * flap, birdScale[i]);
        dummy.updateMatrix();
        birds.setMatrixAt(i, dummy.matrix);
      }
      birds.instanceMatrix.needsUpdate = true;
    }

    /* ------------------------------------------------------------------ *
     * Stats and disposal.
     * ------------------------------------------------------------------ */

    scene.updateMatrixWorld(true);

    var triangleCount = 0;
    var drawCalls = 0;
    var textureList = [foamTex, cloudTex, hazeTex, grassTex, reedTex, flowerTex];
    var textureBytes = 0;
    var tx;

    scene.traverse(function (obj) {
      if (!obj.isMesh) {
        return;
      }
      drawCalls++;
      var geo = obj.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) {
        return;
      }
      var tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      if (obj.isInstancedMesh) {
        tris *= obj.count;
      }
      triangleCount += tris;
    });

    for (tx = 0; tx < textureList.length; tx++) {
      if (textureList[tx] && textureList[tx].image) {
        textureBytes += Math.round(
          textureList[tx].image.width * textureList[tx].image.height * 4 * (4 / 3)
        );
      }
    }

    var stats = {
      triangles: Math.round(triangleCount),
      drawCalls: drawCalls,
      meshes: drawCalls,
      lights: 2,
      textures: textureList.length,
      textureBytes: textureBytes,
      quality: quality
    };
    world.userData.stats = stats;

    if (typeof console !== 'undefined' && console.log) {
      console.log('[LandscapeScene]', quality, stats);
    }

    var disposed = false;

    function dispose() {
      if (disposed) {
        return;
      }
      disposed = true;

      var geometries = [];
      var materials = [];
      var textures = [];

      world.traverse(function (obj) {
        if (obj.geometry && geometries.indexOf(obj.geometry) === -1) {
          geometries.push(obj.geometry);
        }
        var mats = obj.material
          ? (Array.isArray(obj.material) ? obj.material : [obj.material])
          : [];
        for (var mi = 0; mi < mats.length; mi++) {
          var m = mats[mi];
          if (materials.indexOf(m) === -1) {
            materials.push(m);
          }
          if (m.map && textures.indexOf(m.map) === -1) {
            textures.push(m.map);
          }
        }
      });

      for (tx = 0; tx < textures.length; tx++) {
        textures[tx].dispose();
      }
      for (tx = 0; tx < materials.length; tx++) {
        materials[tx].dispose();
      }
      for (tx = 0; tx < geometries.length; tx++) {
        geometries[tx].dispose();
      }

      scene.remove(world);
      scene.background = null;
      scene.fog = null;
      selectables.length = 0;

      while (world.children.length) {
        world.remove(world.children[0]);
      }
    }

    world.userData.eyeHeight = eyeHeight;
    world.userData.quality = quality;

    return {
      scene: scene,
      world: world,
      update: update,
      selectables: selectables,
      dispose: dispose
    };
  }

  var api = { createWorld: createWorld, version: VERSION };
  if (root) { root.LandscapeScene = api; }
}(
  typeof window !== 'undefined'
    ? window
    : (typeof globalThis !== 'undefined' ? globalThis : null)
));
