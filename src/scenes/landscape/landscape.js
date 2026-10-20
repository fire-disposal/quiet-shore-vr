/*!
 * LandscapeScene 4.0.0
 * Procedural lake-at-sunrise scene for Three.js r152 (PICO G2 4K / Adreno 540).
 *
 * ES module (ES5 syntax inside). Exports createWorld and VERSION; no globals.
 * Same contract as ward.js:
 *   createWorld(THREE, { quality, eyeHeight }) ->
 *   { scene, world, update(dt), selectables, dispose }
 *
 * High tier: baked heightfield terrain (dry grass, wet sand, submerged
 * shelf), layered sky dome (warm horizon, sun disk with limb darkening,
 * drifting cirrus, dithered gradients), fresnel water with analytic wave
 * octaves, depth tint, shore wash and sun glitter, two scrolling foam
 * ribbons, ridges / tree line / headlands, conifer + broadleaf trees,
 * wind-swayed grass, flowers and reeds, pebbles, rocks, weathered timber pier
 * with rope rail and a lit lantern, drifting clouds, mist over the water and
 * low birds.
 *
 * High: 24 draw calls, ~43 k triangles. Low: 21 draw calls, ~9 k triangles.
 * No shadow maps, no postprocessing, no per-frame allocations.
 *
 * Camera far plane in main.ts is 100 m, so every distant layer stays inside
 * that distance; the sky dome radius is 90 m.
 */
var VERSION = '4.0.0';
var SHORE_Z = -2.5;
var SKY_RADIUS = 90;

function seeded(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp01(x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

function smoothstep(edge0, edge1, x) {
  var t = (x - edge0) / (edge1 - edge0);
  return clamp01(t) * clamp01(t) * (3 - 2 * clamp01(t));
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
  /* r152 colour management: canvas pixels are authored in sRGB. */
  texture.colorSpace = THREE.SRGBColorSpace;
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

/* Two crossed quads in one geometry: a single instanced draw call that reads
 * as volume from every viewing angle instead of vanishing edge-on. */
function crossQuadGeometry(THREE, width, height) {
  var hw = width * 0.5;
  var hh = height * 0.5;
  var position = [];
  var uv = [];
  var index = [];

  function quad(x0, z0, x1, z1) {
    var base = position.length / 3;
    position.push(
      x0, -hh, z0,
      x1, -hh, z1,
      x1, hh, z1,
      x0, hh, z0
    );
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  quad(-hw, 0, hw, 0);
  quad(0, -hw, 0, hw);

  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
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
  var WATER_SEG_X = low ? 26 : 64;
  var WATER_SEG_Z = low ? 12 : 30;
  var coniferCount = low ? 8 : 26;
  var broadleafCount = low ? 6 : 20;
  var grassCount = low ? 360 : 1200;
  var flowerCount = low ? 48 : 260;
  var reedCount = low ? 32 : 140;
  var pebbleCount = low ? 44 : 240;
  var rockCount = low ? 8 : 30;
  var plankCount = low ? 8 : 15;
  var postCount = low ? 4 : 7;
  var cloudCount = low ? 4 : 12;
  var hazeCount = low ? 2 : 6;
  var mistCount = low ? 0 : 5;
  var birdCount = low ? 5 : 16;
  var ridgeCount = 6;
  var treeLineCount = low ? 14 : 44;
  var headlandCount = low ? 2 : 4;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd6ea);
  scene.fog = new THREE.Fog(0xc9d9e4, 50, 132);

  var world = new THREE.Group();
  scene.add(world);

  world.add(new THREE.HemisphereLight(0xd6e8ff, 0x3d4d2c, 0.72));
  var sunLight = new THREE.DirectionalLight(0xffdcb0, 1.18);
  sunLight.position.set(32, 38, 18);
  world.add(sunLight);

  var sunDir = new THREE.Vector3(-0.26, 0.17, -0.95).normalize();

  /* Shared clock for the wind sway patched into the instanced foliage
   * materials; one uniform object means one write per frame. */
  var windUniforms = { uTime: { value: 0 } };

  function applyWind(material, strength, base) {
    material.onBeforeCompile = function (shader) {
      shader.uniforms.uWindTime = windUniforms.uTime;
      shader.uniforms.uWindStrength = { value: strength };
      shader.uniforms.uWindBase = { value: base };
      shader.vertexShader = [
        'uniform float uWindTime;',
        'uniform float uWindStrength;',
        'uniform float uWindBase;',
        shader.vertexShader
      ].join('\n');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vec2 windAnchor = vec2(0.0);',
          '#ifdef USE_INSTANCING',
          '  windAnchor = instanceMatrix[3].xz;',
          '#endif',
          'float windPhase = uWindTime * 1.35 + windAnchor.x * 0.62 + windAnchor.y * 0.83;',
          'float windSway = sin(windPhase) * 0.62 + sin(windPhase * 1.9 + 1.3) * 0.24;',
          'float windBend = max(transformed.y + uWindBase, 0.0) * uWindStrength;',
          'transformed.x += windSway * windBend;',
          'transformed.z += windSway * windBend * 0.34;'
        ].join('\n')
      );
    };
    return material;
  }

  /* ------------------------------------------------------------------ *
   * World-locked sky dome: elevation ramp, warm azimuth wash, sun disk
   * with limb darkening, drift-lit cirrus and dithered gradients.
   * ------------------------------------------------------------------ */

  var skyUniforms = {
    uTop: { value: new THREE.Color(0x24578c) },
    uMid: { value: new THREE.Color(0x82aecd) },
    uHorizon: { value: new THREE.Color(0xecd2ab) },
    uSunWarm: { value: new THREE.Color(0xffcf9e) },
    uSunDisk: { value: new THREE.Color(0xfff6e2) },
    uCirrus: { value: new THREE.Color(0xf7e7d6) },
    uSunDir: { value: sunDir },
    uTime: { value: 0 }
  };
  var skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: skyUniforms,
    vertexShader: [
      'varying vec3 vDir;',
      'void main() {',
      '  vDir = position;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uTop;',
      'uniform vec3 uMid;',
      'uniform vec3 uHorizon;',
      'uniform vec3 uSunWarm;',
      'uniform vec3 uSunDisk;',
      'uniform vec3 uCirrus;',
      'uniform vec3 uSunDir;',
      'uniform float uTime;',
      'varying vec3 vDir;',
      '',
      'float hash21(vec2 p) {',
      '  p = fract(p * vec2(123.34, 456.21));',
      '  p += dot(p, p + 45.32);',
      '  return fract(p.x * p.y);',
      '}',
      '',
      'float vnoise(vec2 p) {',
      '  vec2 i = floor(p);',
      '  vec2 f = fract(p);',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  float a = hash21(i);',
      '  float b = hash21(i + vec2(1.0, 0.0));',
      '  float c = hash21(i + vec2(0.0, 1.0));',
      '  float d = hash21(i + vec2(1.0, 1.0));',
      '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
      '}',
      '',
      'void main() {',
      '  vec3 d = normalize(vDir);',
      '  float up = clamp(d.y, 0.0, 1.0);',
      '  vec3 sd = normalize(uSunDir);',
      '',
      '  /* Three stop elevation ramp: warm horizon, pale mid sky, deep zenith. */',
      '  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.44, pow(up, 0.72)));',
      '  col = mix(col, uTop, smoothstep(0.15, 0.93, up));',
      '',
      '  /* Warm wash toward the sun keeps the eastern horizon luminous. */',
      '  vec2 flatD = normalize(vec2(d.x, d.z) + vec2(0.00001, 0.0));',
      '  vec2 flatS = normalize(vec2(sd.x, sd.z) + vec2(0.00001, 0.0));',
      '  float az = max(dot(flatD, flatS), 0.0);',
      '  float horizonBand = exp(-up * 7.5);',
      '  col = mix(col, uSunWarm, horizonBand * (0.16 + 0.38 * pow(az, 3.0)));',
      '',
      '  /* Sun glare, soft halo and a disk with limb darkening. */',
      '  float s = max(dot(d, sd), 0.0);',
      '  float ang = acos(clamp(dot(d, sd), -1.0, 1.0));',
      '  float glow = pow(s, 6.0) * 0.14 + pow(s, 28.0) * 0.30 + pow(s, 200.0) * 0.85;',
      '  col += uSunWarm * glow;',
      '  float disk = 1.0 - smoothstep(0.020, 0.027, ang);',
      '  float limb = sqrt(max(0.0, 1.0 - 0.55 * pow(ang / 0.027, 2.0)));',
      '  col = mix(col, uSunDisk, disk * mix(0.72, 1.0, limb));',
      '',
      '  /* Drifting cirrus; a planar projection avoids an atan seam. */',
      '  vec2 cuv = d.xz / max(up + 0.45, 0.3) * 0.8;',
      '  float c1 = vnoise(cuv * 0.9 + vec2(uTime * 0.010, uTime * -0.004));',
      '  float c2 = vnoise(cuv * 2.3 + vec2(uTime * -0.016, 3.7));',
      '  float cirrus = smoothstep(0.52, 0.88, c1 * 0.72 + c2 * 0.42);',
      '  cirrus *= smoothstep(0.04, 0.24, up) * (1.0 - smoothstep(0.68, 0.98, up));',
      '  cirrus *= 0.55 + 0.45 * az;',
      '  col = mix(col, uCirrus, cirrus * 0.40);',
      '',
      '  /* Ordered dither: keeps the ramp band free on 8 bit panels. */',
      '  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.004;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  var skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, low ? 24 : 48, low ? 12 : 24),
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
      /* Fine relief only away from the walkable shore. */
      h += (Math.sin(x * 0.31 + 1.3) * Math.cos(z * 0.27) * 0.34 +
        Math.sin(x * 0.63 - z * 0.51) * 0.16) * land;
    }
    return h;
  }

  var terrainGeo = new THREE.PlaneGeometry(260, 260, TERRAIN_SEG, TERRAIN_SEG);
  terrainGeo.rotateX(-Math.PI / 2);
  var tPos = terrainGeo.attributes.position;
  var tColors = new Float32Array(tPos.count * 3);
  var sand = new THREE.Color(0xc0a878);
  var wetSand = new THREE.Color(0x8a7454);
  var submergedSand = new THREE.Color(0x6d6247);
  var grassLow = new THREE.Color(0x41662f);
  var grassHigh = new THREE.Color(0x5f7c45);
  var dryGrass = new THREE.Color(0x9a8f5a);
  var rockTint = new THREE.Color(0x6f735e);
  var tmpColor = new THREE.Color();
  var ti;
  for (ti = 0; ti < tPos.count; ti++) {
    var tx = tPos.getX(ti);
    var tz = tPos.getZ(ti);
    var th = terrainHeight(tx, tz);
    tPos.setY(ti, th);

    var moisture = 0.5 + 0.5 * Math.sin(tx * 0.19) * Math.cos(tz * 0.16);
    var patch = Math.sin(tx * 0.83 + 0.7) * Math.cos(tz * 0.61 - 0.4);
    tmpColor.copy(grassLow).lerp(
      grassHigh,
      clamp01(moisture * 0.72 + 0.15 + patch * 0.1)
    );
    tmpColor.lerp(dryGrass, clamp01(th / 9) * 0.30 * clamp01(0.5 + patch * 0.5));

    var lateral = 1 - smoothstep(24, 44, Math.abs(tx));
    if (lateral > 0) {
      var dryBand = smoothstep(SHORE_Z + 0.55, SHORE_Z + 1.5, tz) *
        (1 - smoothstep(SHORE_Z + 2.4, SHORE_Z + 4.8, tz));
      var wetBand = 1 - smoothstep(SHORE_Z + 0.1, SHORE_Z + 1.35, tz);
      tmpColor.lerp(sand, dryBand * lateral * 0.85);
      tmpColor.lerp(wetSand, wetBand * lateral * 0.8);
      if (tz < SHORE_Z - 0.4) {
        tmpColor.lerp(submergedSand, lateral * 0.85);
      }
    }
    if (th > 4.5) {
      tmpColor.lerp(rockTint, Math.min(1, (th - 4.5) / 15) * 0.6);
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
   * Water: analytic wave normals, Schlick fresnel, depth tint, shore
   * wash and a sun glitter path. Everything is uniform driven.
   * ------------------------------------------------------------------ */

  var waterUniforms = {
    uTime: { value: 0 },
    uShoreZ: { value: SHORE_Z },
    uDeep: { value: new THREE.Color(0x1d5c80) },
    uShallow: { value: new THREE.Color(0x74c0c4) },
    uSkyTop: { value: new THREE.Color(0x9fc6dd) },
    uSkyHorizon: { value: new THREE.Color(0xf2d7b4) },
    uSun: { value: new THREE.Color(0xffe7bf) },
    uFog: { value: new THREE.Color(0xc9d9e4) },
    uFogRange: { value: new THREE.Vector2(50, 132) },
    uSunDir: { value: sunDir }
  };
  var waterMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: [
      'uniform float uTime;',
      'uniform float uShoreZ;',
      'varying vec3 vWorld;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  float offshore = 1.0 - smoothstep(uShoreZ - 9.0, uShoreZ - 1.5, wp.z);',
      '  float swell = sin(wp.x * 0.21 + uTime * 0.55) * 0.055',
      '    + sin(wp.z * 0.33 - uTime * 0.43 + 1.7) * 0.045',
      '    + sin((wp.x + wp.z) * 0.11 + uTime * 0.31) * 0.035;',
      '  wp.y += swell * offshore;',
      '  vWorld = wp.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform float uTime;',
      'uniform vec3 uDeep;',
      'uniform vec3 uShallow;',
      'uniform vec3 uSkyTop;',
      'uniform vec3 uSkyHorizon;',
      'uniform vec3 uSun;',
      'uniform vec3 uFog;',
      'uniform vec2 uFogRange;',
      'uniform vec3 uSunDir;',
      'varying vec3 vWorld;',
      '',
      'float hash21(vec2 p) {',
      '  p = fract(p * vec2(123.34, 456.21));',
      '  p += dot(p, p + 45.32);',
      '  return fract(p.x * p.y);',
      '}',
      '',
      'float vnoise(vec2 p) {',
      '  vec2 i = floor(p);',
      '  vec2 f = fract(p);',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  float a = hash21(i);',
      '  float b = hash21(i + vec2(1.0, 0.0));',
      '  float c = hash21(i + vec2(0.0, 1.0));',
      '  float d = hash21(i + vec2(1.0, 1.0));',
      '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
      '}',
      '',
      'void main() {',
      '  vec2 p = vWorld.xz;',
      '  vec3 toEye = cameraPosition - vWorld;',
      '  float dist = length(toEye);',
      '  vec3 viewDir = toEye / max(dist, 0.001);',
      '  float detail = 1.0 - smoothstep(15.0, 58.0, dist);',
      '  float fine = detail * detail;',
      '',
      '  /* Analytic gradient of three wave octaves: no extra texture taps. */',
      '  vec2 grad = vec2(0.0);',
      '  float a1 = p.x * 0.62 + uTime * 0.85;',
      '  float b1 = p.y * 0.46 - uTime * 0.58;',
      '  float sa1 = sin(a1);',
      '  float ca1 = cos(a1);',
      '  float sb1 = sin(b1);',
      '  float cb1 = cos(b1);',
      '  float swell = sa1 * sb1;',
      '  grad += vec2(0.62 * ca1 * sb1, 0.46 * sa1 * cb1);',
      '',
      '  float a2 = p.x * 0.23 - p.y * 0.37 + uTime * 0.41;',
      '  grad += vec2(0.23, -0.37) * (0.24 * cos(a2)) * (0.35 + 0.65 * detail);',
      '',
      '  float a3 = p.x * 1.85 - p.y * 1.35 + uTime * 1.35;',
      '  float a4 = p.x * 4.1 + p.y * 3.2 - uTime * 2.05;',
      '  grad += (vec2(1.85, -1.35) * (0.42 * cos(a3)) +',
      '    vec2(4.1, 3.2) * (0.26 * cos(a4))) * fine;',
      '',
      '  vec3 n = normalize(vec3(-grad.x * 0.075, 1.0, -grad.y * 0.075));',
      '',
      '  float ndv = clamp(dot(n, viewDir), 0.0, 1.0);',
      '  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);',
      '',
      '  float shallow = smoothstep(-24.0, -2.6, vWorld.z);',
      '  vec3 base = mix(uDeep, uShallow, shallow * 0.78);',
      '  base = mix(base, uShallow, clamp(swell * 0.5 + 0.5, 0.0, 1.0) * 0.12);',
      '',
      '  vec3 refl = reflect(-viewDir, n);',
      '  float skyUp = clamp(refl.y, 0.0, 1.0);',
      '  vec3 skyCol = mix(uSkyHorizon, uSkyTop, pow(skyUp, 0.55));',
      '  vec3 col = mix(base, skyCol, clamp(fres * 0.85 + 0.06, 0.0, 1.0));',
      '',
      '  /* Sun glitter: a tight core whose width widens with distance. */',
      '  vec3 halfV = normalize(normalize(uSunDir) + viewDir);',
      '  float ndh = max(dot(n, halfV), 0.0);',
      '  float specPow = mix(360.0, 70.0, smoothstep(8.0, 48.0, dist));',
      '  float spec = pow(ndh, specPow);',
      '  float glint = vnoise(p * 1.15 + vec2(uTime * 0.18, -uTime * 0.12));',
      '  glint = 0.4 + 1.2 * glint * glint;',
      '  col += uSun * spec * glint * mix(2.0, 0.85, smoothstep(6.0, 46.0, dist));',
      '  col += uSun * pow(ndh, 9.0) * 0.05;',
      '',
      '  /* Lapping wash along the waterline. */',
      '  float wash = smoothstep(-4.6, -2.55, vWorld.z);',
      '  float lap = 0.5 + 0.5 * sin(vWorld.z * 6.2 + uTime * 1.15 + vWorld.x * 0.85);',
      '  col = mix(col, vec3(0.93, 0.965, 0.975), wash * (0.32 + 0.68 * lap) * 0.30);',
      '',
      '  col = mix(col, uFog, smoothstep(uFogRange.x, uFogRange.y, dist));',
      '  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.006;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  var water = new THREE.Mesh(
    new THREE.PlaneGeometry(130, 52, WATER_SEG_X, WATER_SEG_Z),
    waterMaterial
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.05, SHORE_Z - 26);
  water.name = 'water';
  world.add(water);

  /* ------------------------------------------------------------------ *
   * Foam: one generator texture sampled twice per ribbon with opposing
   * scroll so the shoreline never repeats visibly.
   * ------------------------------------------------------------------ */

  var foamTex = canvasTexture(THREE, 1024, 64, function (ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (var i = 0; i < 260; i++) {
      var y = h * 0.3 + rnd() * h * 0.55;
      var x = rnd() * w;
      var len = 8 + rnd() * 40;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.1 + rnd() * 0.55) + ')';
      ctx.lineWidth = 0.7 + rnd() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len * 0.5, y + (rnd() - 0.5) * 6, x + len, y + (rnd() - 0.5) * 4);
      ctx.stroke();
    }
    for (var j = 0; j < 90; j++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.08 + rnd() * 0.22) + ')';
      ctx.beginPath();
      ctx.arc(rnd() * w, h * 0.35 + rnd() * h * 0.5, 0.6 + rnd() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 1, 1);

  var foamUniforms = {
    uTime: { value: 0 },
    uTint: { value: new THREE.Color(0xf4fbff) }
  };

  function makeFoam(width, depth, z, opacity, scroll, scale) {
    var material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: foamTex },
        uTime: foamUniforms.uTime,
        uTint: { value: foamUniforms.uTint.value },
        uSpeed: { value: scroll },
        uOpacity: { value: opacity },
        uScale: { value: scale }
      },
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap;',
        'uniform float uTime;',
        'uniform vec3 uTint;',
        'uniform float uSpeed;',
        'uniform float uOpacity;',
        'uniform float uScale;',
        'varying vec2 vUv;',
        'void main() {',
        '  float a1 = texture2D(uMap, vec2(vUv.x * uScale + uTime * uSpeed, vUv.y)).a;',
        '  float a2 = texture2D(uMap, vec2(vUv.x * uScale * 0.57 - uTime * uSpeed * 1.9,',
        '    vUv.y * 0.75 + 0.15)).a;',
        '  float a = a1 * 0.8 + a2 * 0.55;',
        '  float band = smoothstep(0.02, 0.22, vUv.y) * (1.0 - smoothstep(0.62, 0.98, vUv.y));',
        '  float lap = 0.72 + 0.28 * sin(uTime * 0.9 + vUv.x * 6.0);',
        '  gl_FragColor = vec4(uTint, a * band * lap * uOpacity);',
        '}'
      ].join('\n')
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.075, z);
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    return mesh;
  }

  var foam = makeFoam(88, 0.9, SHORE_Z - 0.18, 0.55, 0.035, 3.0);
  foam.name = 'foam';
  world.add(foam);

  var foamWash = null;
  if (!low) {
    foamWash = makeFoam(104, 2.2, SHORE_Z - 1.35, 0.26, 0.05, 1.3);
    foamWash.name = 'foam-wash';
    world.add(foamWash);
  }

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
  var coniferTiers = [
    [1.42, 1.02, 1.95],
    [2.20, 0.80, 1.66],
    [2.90, 0.56, 1.36],
    [3.55, 0.30, 0.98]
  ];
  var crowns = new THREE.InstancedMesh(crownGeo, crownMat, coniferCount * coniferTiers.length);
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
    [-55, -60], [55, -62], [-24, 14], [28, 16],
    [-60, -30], [62, -34]
  ];
  var coniferColors = [0x2f6b3e, 0x347040, 0x296236, 0x3a7247];

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
      crowns.setColorAt(coniferIdx, tint.setHex(coniferColors[(tier + si) % 4]));
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
   * Grass and reeds use crossed quads so they hold up from every angle;
   * the wind patch bends them without touching instance matrices.
   * ------------------------------------------------------------------ */

  function bladeTexture(ppp, size) {
    return canvasTexture(THREE, size, size, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (var i = 0; i < ppp; i++) {
        var x = 4 + i * (w - 8) / Math.max(ppp - 1, 1) + (rnd() - 0.5) * 4;
        var top = 4 + rnd() * (h * 0.4);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 + rnd() * 0.3) + ')';
        ctx.lineWidth = (1.1 + rnd() * 1.4) * (size / 64);
        ctx.beginPath();
        ctx.moveTo(x, h - 2);
        ctx.quadraticCurveTo(
          x + (rnd() - 0.5) * 10,
          h * 0.45,
          x + (rnd() - 0.5) * 18,
          top
        );
        ctx.stroke();
      }
    });
  }

  function reedTexture(size) {
    return canvasTexture(THREE, size, size, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (var i = 0; i < 11; i++) {
        var x = 6 + i * (w - 12) / 10 + (rnd() - 0.5) * 5;
        var top = 4 + rnd() * 10;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + rnd() * 0.4) + ')';
        ctx.lineWidth = 1.0 + rnd() * 1.2;
        ctx.beginPath();
        ctx.moveTo(x, h - 2);
        ctx.quadraticCurveTo(x + (rnd() - 0.5) * 8, h * 0.5, x + (rnd() - 0.5) * 5, top + 12);
        ctx.stroke();
        /* Seed head: a soft club at the tip. */
        if (rnd() > 0.35) {
          ctx.fillStyle = 'rgba(255,246,232,' + (0.55 + rnd() * 0.35) + ')';
          ctx.beginPath();
          ctx.ellipse(x, top + 8, 1.6 + rnd() * 1.2, 5 + rnd() * 4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }

  var grassTex = bladeTexture(11, low ? 64 : 128);
  var grassGeo = crossQuadGeometry(THREE, 0.55, 0.62);
  var grassMat = applyWind(new THREE.MeshLambertMaterial({
    map: grassTex,
    color: 0xffffff,
    side: THREE.DoubleSide,
    alphaTest: 0.35
  }), 0.16, 0.31);
  var grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
  grass.frustumCulled = false;
  for (si = 0; si < grassCount; si++) {
    var gx = (rnd() * 2 - 1) * 34;
    var gz = -1.8 + rnd() * 12;
    var gy = terrainHeight(gx, gz);
    var gs = 0.35 + rnd() * 0.5;
    dummy.position.set(gx, gy + 0.31 * gs, gz);
    dummy.rotation.set(0, rnd() * Math.PI, (rnd() - 0.5) * 0.22);
    dummy.scale.set(gs, gs, gs);
    dummy.updateMatrix();
    grass.setMatrixAt(si, dummy.matrix);
    grass.setColorAt(si, tint.setHex(si % 4 === 0 ? 0x5c7b3d :
      (si % 4 === 1 ? 0x6a8746 : (si % 4 === 2 ? 0x55703c : 0x74884a))));
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
  var flowerMat = applyWind(new THREE.MeshBasicMaterial({
    map: flowerTex,
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.3,
    depthWrite: false
  }), 0.13, 0.21);
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

  var reedTex = reedTexture(low ? 64 : 128);
  var reedGeo = crossQuadGeometry(THREE, 0.5, 0.95);
  var reedMat = applyWind(new THREE.MeshLambertMaterial({
    map: reedTex,
    color: 0xffffff,
    side: THREE.DoubleSide,
    alphaTest: 0.35
  }), 0.11, 0.475);
  var reeds = new THREE.InstancedMesh(reedGeo, reedMat, reedCount);
  reeds.frustumCulled = false;
  for (si = 0; si < reedCount; si++) {
    var rx = -18 + (si / Math.max(reedCount - 1, 1)) * 36 + (rnd() - 0.5) * 1.6;
    if (rx > 0.8 && rx < 4.6) {
      rx += 5.0;
    }
    var rz = -2.1 - rnd() * 0.9;
    var rs = 0.55 + rnd() * 0.55;
    dummy.position.set(rx, 0.475 * rs, rz);
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
   * Pier: weathered planks, posts, a rope rail and a lit lantern.
   * ------------------------------------------------------------------ */

  var woodTex = canvasTexture(THREE, 128, 128, function (ctx, w, h) {
    ctx.fillStyle = '#8b6a46';
    ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < 30; i++) {
      var y = rnd() * h;
      ctx.strokeStyle = 'rgba(56,36,18,' + (0.07 + rnd() * 0.2) + ')';
      ctx.lineWidth = 0.5 + rnd() * 1.7;
      ctx.beginPath();
      ctx.moveTo(-2, y);
      for (var x = 0; x <= w + 8; x += 16) {
        ctx.lineTo(x, y + Math.sin(x * 0.12 + i * 1.7) * (0.8 + rnd() * 1.6));
      }
      ctx.stroke();
    }
    for (var k = 0; k < 3; k++) {
      var kx = 8 + rnd() * (w - 16);
      var ky = 8 + rnd() * (h - 16);
      var kr = 5 + rnd() * 6;
      var g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      g.addColorStop(0, 'rgba(48,30,16,0.55)');
      g.addColorStop(0.6, 'rgba(78,52,30,0.22)');
      g.addColorStop(1, 'rgba(120,90,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      ctx.fill();
    }
    for (var s = 0; s < 60; s++) {
      ctx.fillStyle = 'rgba(40,26,14,' + (0.04 + rnd() * 0.1) + ')';
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
    }
  }, 1, 1);

  var boxGeo = new THREE.BoxGeometry(1, 1, 1);
  var woodMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: woodTex });
  var pierX = 2.5;
  var pierStep = 1.02;
  var ropeCount = Math.max(postCount - 1, 0) * 2;
  var pier = new THREE.InstancedMesh(boxGeo, woodMat, plankCount + postCount * 2 + ropeCount);
  pier.frustumCulled = false;
  pier.name = 'pier';
  for (si = 0; si < plankCount; si++) {
    var ppz = -1.1 - si * pierStep;
    dummy.position.set(pierX, 0.2, ppz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.4, 0.1, 0.95 - (si % 3) * 0.03);
    dummy.updateMatrix();
    pier.setMatrixAt(si, dummy.matrix);
    pier.setColorAt(si, tint.setHex(si % 2 === 0 ? 0xf0e2cd : 0xdfcdb6));
  }
  for (si = 0; si < postCount * 2; si++) {
    var postZ = -1.1 - Math.floor(si / 2) * (pierStep * 2);
    var postX = pierX + (si % 2 === 0 ? -0.62 : 0.62);
    dummy.position.set(postX, 0.12, postZ);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.13, 1.3, 0.13);
    dummy.updateMatrix();
    pier.setMatrixAt(plankCount + si, dummy.matrix);
    pier.setColorAt(plankCount + si, tint.setHex(0xcbb595));
  }
  for (si = 0; si < ropeCount; si++) {
    var ropeSide = si % 2 === 0 ? -0.62 : 0.62;
    var ropeZ = -1.1 - (Math.floor(si / 2) * (pierStep * 2) + pierStep);
    dummy.position.set(pierX + ropeSide, 0.68, ropeZ);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.035, 0.035, pierStep * 2 - 0.06);
    dummy.updateMatrix();
    pier.setMatrixAt(plankCount + postCount * 2 + si, dummy.matrix);
    pier.setColorAt(plankCount + postCount * 2 + si, tint.setHex(0xd8c9a8));
  }
  pier.instanceMatrix.needsUpdate = true;
  if (pier.instanceColor) {
    pier.instanceColor.needsUpdate = true;
  }
  world.add(pier);

  var lanternPos = new THREE.Vector3(pierX + 0.45, 0.9, -1.1 - (plankCount - 1) * pierStep);
  var lantern = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.34, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
  );
  lantern.position.copy(lanternPos);
  lantern.name = 'lantern';
  world.add(lantern);

  var glowTex = null;
  var lanternGlow = null;
  if (!low) {
    glowTex = canvasTexture(THREE, 128, 128, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,231,178,0.95)');
      g.addColorStop(0.35, 'rgba(255,198,124,0.34)');
      g.addColorStop(1, 'rgba(255,170,96,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    lanternGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      })
    );
    lanternGlow.position.copy(lanternPos);
    lanternGlow.position.z += 0.02;
    lanternGlow.renderOrder = 6;
    lanternGlow.name = 'lantern-glow';
    world.add(lanternGlow);
  }

  /* ------------------------------------------------------------------ *
   * Clouds, low mist over the water, haze layers and birds.
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
  cloudMesh.name = 'clouds';
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
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      fog: false
    }),
    hazeCount
  );
  hazeMesh.renderOrder = 4;
  hazeMesh.frustumCulled = false;
  hazeMesh.name = 'haze';
  world.add(hazeMesh);

  var mistMesh = null;
  if (mistCount > 0) {
    mistMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: hazeTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.17,
        depthWrite: false,
        fog: false
      }),
      mistCount
    );
    mistMesh.renderOrder = 2;
    mistMesh.frustumCulled = false;
    mistMesh.name = 'mist';
    world.add(mistMesh);
  }

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
  birds.name = 'birds';
  world.add(birds);

  /* Per-instance animation state, allocated once. */
  var cloudBaseX = [];
  var cloudBaseY = [];
  var cloudBaseZ = [];
  var cloudW = [];
  var cloudH = [];
  var cloudTilt = [];
  var cloudPhase = [];
  var cloudSpeed = [];
  var cloudTravel = [];
  var cloudColors = [0xfff0e4, 0xffe0cd, 0xfff6ef, 0xffd8c2];
  var cloudDefs = [
    [-58, -74, 38, 12, 30], [-28, -86, 28, 9, 36],
    [2, -80, 46, 14, 26], [34, -88, 32, 10, 32],
    [58, -76, 26, 9, 38], [76, -70, 40, 12, 28],
    [-70, -82, 32, 10, 34], [18, -70, 24, 8, 40],
    [48, -68, 30, 10, 25], [-46, -66, 26, 9, 39],
    [12, -62, 22, 7, 44], [-86, -66, 30, 9, 33]
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
    cloudSpeed.push(0.012 + rnd() * 0.016);
    cloudTravel.push(4 + rnd() * 5);
  }

  var hazeDefs = [
    [-62, 8.6, 26, 210], [-76, 9.6, 30, 210],
    [-88, 11.0, 34, 210], [-28, 1.5, 4.2, 90],
    [-44, 2.1, 5.0, 110], [-12, 2.6, 4.6, 120]
  ];
  var hazeColors = [0xffe4c4, 0xeaf3fa, 0xffd9bb, 0xeef6fc, 0xffe9d2, 0xe8f2f9];
  for (si = 0; si < hazeCount; si++) {
    var hd = hazeDefs[si % hazeDefs.length];
    dummy.position.set(0, hd[1], hd[0]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(hd[3], hd[2], 1);
    dummy.updateMatrix();
    hazeMesh.setMatrixAt(si, dummy.matrix);
    hazeMesh.setColorAt(si, tint.setHex(hazeColors[si % hazeColors.length]));
  }
  hazeMesh.instanceMatrix.needsUpdate = true;
  if (hazeMesh.instanceColor) {
    hazeMesh.instanceColor.needsUpdate = true;
  }

  var mistBaseX = [];
  var mistBaseY = [];
  var mistBaseZ = [];
  var mistW = [];
  var mistH = [];
  var mistPhase = [];
  var mistDefs = [
    [-30, 1.15, -14, 26, 3.4],
    [8, 0.95, -18, 30, 3.0],
    [-12, 1.35, -26, 34, 3.6],
    [26, 1.05, -34, 30, 3.2],
    [-46, 1.25, -40, 36, 3.8]
  ];
  for (si = 0; si < mistCount; si++) {
    var md = mistDefs[si % mistDefs.length];
    mistBaseX.push(md[0]);
    mistBaseY.push(md[1]);
    mistBaseZ.push(md[2]);
    mistW.push(md[3]);
    mistH.push(md[4]);
    mistPhase.push(si * 2.1);
    dummy.position.set(md[0], md[1], md[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(md[3], md[4], 1);
    dummy.updateMatrix();
    mistMesh.setMatrixAt(si, dummy.matrix);
    mistMesh.setColorAt(si, tint.setHex(si % 2 === 0 ? 0xf4fbff : 0xfff1e2));
  }
  if (mistMesh) {
    mistMesh.instanceMatrix.needsUpdate = true;
    if (mistMesh.instanceColor) {
      mistMesh.instanceColor.needsUpdate = true;
    }
  }

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
    cloudMesh.setColorAt(si, tint.setHex(cloudColors[si % cloudColors.length]));
  }
  cloudMesh.instanceMatrix.needsUpdate = true;
  if (cloudMesh.instanceColor) {
    cloudMesh.instanceColor.needsUpdate = true;
  }

  for (si = 0; si < birdCount; si++) {
    dummy.position.set(birdBaseX[si], birdBaseY[si], birdBaseZ[si]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(birdScale[si], birdScale[si], birdScale[si]);
    dummy.updateMatrix();
    birds.setMatrixAt(si, dummy.matrix);
  }
  birds.instanceMatrix.needsUpdate = true;

  var selectables = [];

  /* ------------------------------------------------------------------ *
   * Animation: uniforms and instance matrices only.
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
    skyUniforms.uTime.value = elapsed;
    windUniforms.uTime.value = elapsed;
    foamUniforms.uTime.value = elapsed;

    for (i = 0; i < cloudCount; i++) {
      dummy.position.set(
        cloudBaseX[i] + Math.sin(elapsed * cloudSpeed[i] + cloudPhase[i]) * cloudTravel[i],
        cloudBaseY[i] + Math.sin(elapsed * 0.09 + cloudPhase[i]) * 0.4,
        cloudBaseZ[i]
      );
      dummy.rotation.set(0, 0, cloudTilt[i]);
      dummy.scale.set(cloudW[i], cloudH[i], 1);
      dummy.updateMatrix();
      cloudMesh.setMatrixAt(i, dummy.matrix);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;

    for (i = 0; i < mistCount; i++) {
      dummy.position.set(
        mistBaseX[i] + Math.sin(elapsed * 0.035 + mistPhase[i]) * 2.2,
        mistBaseY[i] + Math.sin(elapsed * 0.12 + mistPhase[i]) * 0.12,
        mistBaseZ[i]
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(mistW[i], mistH[i], 1);
      dummy.updateMatrix();
      mistMesh.setMatrixAt(i, dummy.matrix);
    }
    if (mistMesh) {
      mistMesh.instanceMatrix.needsUpdate = true;
    }

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
  var textureList = [
    foamTex, cloudTex, hazeTex, grassTex, reedTex,
    flowerTex, woodTex, glowTex
  ];
  var textureBytes = 0;
  var tx;
  var createdTextures = [];
  for (tx = 0; tx < textureList.length; tx++) {
    if (textureList[tx]) {
      createdTextures.push(textureList[tx]);
    }
  }

  world.traverse(function (obj) {
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

  for (tx = 0; tx < createdTextures.length; tx++) {
    if (createdTextures[tx].image) {
      textureBytes += Math.round(
        createdTextures[tx].image.width * createdTextures[tx].image.height * 4 * (4 / 3)
      );
    }
  }

  var stats = {
    triangles: Math.round(triangleCount),
    drawCalls: drawCalls,
    meshes: drawCalls,
    lights: 2,
    textures: createdTextures.length,
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
        if (m.uniforms) {
          for (var key in m.uniforms) {
            if (!Object.prototype.hasOwnProperty.call(m.uniforms, key)) {
              continue;
            }
            var value = m.uniforms[key] ? m.uniforms[key].value : null;
            if (value && value.isTexture && textures.indexOf(value) === -1) {
              textures.push(value);
            }
          }
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

export { createWorld, VERSION };
