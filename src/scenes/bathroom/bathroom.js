/*!
 * BathroomScene 2.0.0
 * Procedural ward bathroom for Three.js 0.152 (PICO G2 4K / Firefox Reality 10).
 *
 * ES module (ES5 syntax inside). Exports createWorld and VERSION; no globals.
 *
 * Contract:
 *   var built = createWorld(THREE, { quality: 'high', eyeHeight: 1.6 });
 *   built.scene        THREE.Scene
 *   built.world        THREE.Group containing every mesh and light (floor at local y = 0)
 *   built.update(dt)   cheap animation tick, seconds; allocates nothing
 *   built.selectables  array of 3 Meshes with userData.selectable === true
 *                      (mirror, grab bar, emergency call unit)
 *   built.dispose()    releases geometries, materials and generated textures
 *
 * The room is authored at real-world scale so WebXR `local` space can be fixed with
 *   world.position.y = -world.userData.eyeHeight;
 * while a 2D preview keeps world.position.y = 0. The patient stands at the local
 * origin facing -z: the toilet sits exactly ahead at x = 0, z ~= -0.95, with the
 * cistern against the back wall. Accessible grab bars flank it, the emergency
 * call cord hangs to its left, the compact vanity and mirror sit in the back-left
 * corner, and a curbless wet area with a folding seat runs along the right wall.
 */
var VERSION = '2.0.0';
var BG_COLOR = 0x1b1d19;
var FOG_COLOR = 0x1b1d19;

/* 房间尺寸（米） */
var ROOM_W = 2.8;   /* x 方向 */
var ROOM_D = 3.0;   /* z 方向 */
var ROOM_H = 2.55;  /* 层高 */

/* 浅灰绿墙砖：0.6 m 宽 x 1.2 m 高，一张纹理正好一块 */
var TILE_W = 0.6;
var TILE_H = 1.2;

/* 紧凑壁挂洗手台（后墙左侧） */
var VANITY_X = -1.08;
var VANITY_Z = -1.33;
var COUNTER_H = 0.83;

/* 马桶：正对患者，水箱靠后墙，面朝 +z */
var WC_X = 0;
var WC_Z = -0.95;
var WATER_Y = 0.424;

/* 磨砂窗（左墙） */
var WINDOW_Z = -0.1;

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

/* 确定性伪随机，纹理生成时避免每次刷新颗粒不同 */
function seeded(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Canvas textures (all power-of-two, locally generated, no bitmaps)
 * ------------------------------------------------------------------ */

function createCanvasTexture(THREE, width, height, paint, repeat) {
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
  var tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.needsUpdate = true;
  tex.userData = { width: width, height: height };
  return tex;
}

/* 浅鼠尾草大砖：一砖一纹理，窄缝、亚光釉面，色差轻轻可见 */
function paintTile(ctx, w, h) {
  var rnd = seeded(0x6a3d19);
  var i, g;
  var padX = Math.max(2, Math.round(w * 0.015));
  var padY = Math.max(2, Math.round(h * 0.008));

  /* 缝底色：暖灰绿 */
  ctx.fillStyle = '#b9bfb1';
  ctx.fillRect(0, 0, w, h);

  /* 砖面：奶油白到浅鼠尾草，竖向缓变 */
  g = ctx.createLinearGradient(0, padY, 0, h - padY);
  g.addColorStop(0, '#eef0e2');
  g.addColorStop(0.45, '#e4e9d7');
  g.addColorStop(1, '#d9e0cc');
  ctx.fillStyle = g;
  ctx.fillRect(padX, padY, w - padX * 2, h - padY * 2);

  /* 大面积云状色差：一点鼠尾草、一点暖白，避免塑料感 */
  for (i = 0; i < 24; i++) {
    var cx = padX + rnd() * (w - padX * 2);
    var cy = padY + rnd() * (h - padY * 2);
    var rr = 8 + rnd() * w * 0.22;
    var blob = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    var sage = rnd() < 0.55;
    blob.addColorStop(0, sage ? 'rgba(140,156,128,0.10)' : 'rgba(255,252,240,0.12)');
    blob.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
  }

  /* 细矿物斑点：非常克制，避免成“脏点” */
  for (i = 0; i < 420; i++) {
    ctx.fillStyle = 'rgba(118,128,106,' + (0.025 + rnd() * 0.035).toFixed(3) + ')';
    ctx.fillRect(padX + rnd() * (w - padX * 2), padY + rnd() * (h - padY * 2), 1, 1 + rnd());
  }

  /* 砖沿倒角：极轻的高光/阴影，缝不抢画面 */
  ctx.fillStyle = 'rgba(255,255,250,0.18)';
  ctx.fillRect(padX, padY, w - padX * 2, 1);
  ctx.fillRect(padX, padY, 1, h - padY * 2);
  ctx.fillStyle = 'rgba(96,104,88,0.14)';
  ctx.fillRect(padX, h - padY - 1, w - padX * 2, 1);
  ctx.fillRect(w - padX - 1, padY, 1, h - padY * 2);
}

/* 非滑地面：暖灰绿亚光面层，细密防滑骨料，无拼缝，1 m 见方可无缝平铺 */
function paintFloor(ctx, w, h) {
  var rnd = seeded(0x21b47d);
  var i;
  /* 均匀底色：不做过界渐变，1 m 平铺不会出现方块 */
  ctx.fillStyle = '#98a294';
  ctx.fillRect(0, 0, w, h);

  /* 细密防滑骨料：均匀分布，平铺接缝不显 */
  for (i = 0; i < 3200; i++) {
    ctx.fillStyle = 'rgba(78,86,76,' + (0.04 + rnd() * 0.08).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1);
  }
  for (i = 0; i < 1500; i++) {
    ctx.fillStyle = 'rgba(226,232,220,' + (0.03 + rnd() * 0.06).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
}

/* 浅橡木：竖向木纹（v 方向），明亮少结疤，适合病房家具 */
function paintOak(ctx, w, h) {
  var rnd = seeded(0x4f0c2e);
  var i, x, y;
  var g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#cbae84');
  g.addColorStop(0.5, '#d4b98f');
  g.addColorStop(1, '#c6a87c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* 顺纹长线：沿 y 走，x 上做很轻的正弦扰动 */
  for (i = 0; i < 40; i++) {
    x = rnd() * w;
    var amp = 0.6 + rnd() * 1.8;
    var freq = 0.018 + rnd() * 0.028;
    var phase = rnd() * Math.PI * 2;
    ctx.strokeStyle = rnd() < 0.5
      ? 'rgba(150,118,84,' + (0.08 + rnd() * 0.14).toFixed(3) + ')'
      : 'rgba(236,216,184,' + (0.07 + rnd() * 0.12).toFixed(3) + ')';
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    ctx.beginPath();
    for (y = 0; y <= h; y += 4) {
      var px = x + Math.sin(y * freq + phase) * amp;
      if (y === 0) {
        ctx.moveTo(px, y);
      } else {
        ctx.lineTo(px, y);
      }
    }
    ctx.stroke();
  }

  /* 少量浅结疤 */
  for (i = 0; i < 2; i++) {
    var kx = 10 + rnd() * (w - 20);
    var ky = 10 + rnd() * (h - 20);
    ctx.strokeStyle = 'rgba(150,118,82,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(kx, ky, 2 + rnd() * 2, 3 + rnd() * 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* 细木孔 */
  for (i = 0; i < 620; i++) {
    ctx.fillStyle = 'rgba(146,116,84,' + (0.02 + rnd() * 0.04).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 2);
  }
}

/* 镜面：不是真反射，而是一张“反射了浅色房间与暖灯”的低成本贴图 */
function paintMirror(ctx, w, h) {
  var rnd = seeded(0x77c1a3);
  var i;
  var g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f6f6ee');
  g.addColorStop(0.34, '#e8eadf');
  g.addColorStop(0.68, '#d4d8ca');
  g.addColorStop(1, '#b8beb0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* 镜前灯的光斑（上缘偏中） */
  var bloom = ctx.createRadialGradient(w * 0.5, h * 0.16, 0, w * 0.5, h * 0.16, w * 0.44);
  bloom.addColorStop(0, 'rgba(255,248,232,0.92)');
  bloom.addColorStop(0.45, 'rgba(255,244,222,0.32)');
  bloom.addColorStop(1, 'rgba(255,244,222,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);

  /* 对面墙、台面的模糊投影 */
  ctx.fillStyle = 'rgba(150,158,140,0.16)';
  ctx.fillRect(0, h * 0.60, w, h * 0.15);
  ctx.fillStyle = 'rgba(118,126,110,0.12)';
  ctx.fillRect(0, h * 0.78, w, h * 0.22);

  /* 左右边缘暗角 */
  var side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(58,62,54,0.26)');
  side.addColorStop(0.08, 'rgba(58,62,54,0)');
  side.addColorStop(0.92, 'rgba(58,62,54,0)');
  side.addColorStop(1, 'rgba(58,62,54,0.26)');
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w, h);

  for (i = 0; i < 180; i++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + rnd() * 0.04).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
}

/* 磨砂窗：暖白日光漫射，斜向光带与柔和光斑，背后有模糊绿影 */
function paintWindow(ctx, w, h) {
  var rnd = seeded(0x5ad0f1);
  var i;
  var g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#f4dcb8');
  g.addColorStop(0.55, '#ffeac8');
  g.addColorStop(1, '#fff7e6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* 斜向日光带 */
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.6);
  for (i = -2; i <= 2; i++) {
    ctx.fillStyle = 'rgba(255,253,246,' + (0.10 + rnd() * 0.09).toFixed(3) + ')';
    ctx.fillRect(i * w * 0.28 - w * 0.05, -h, w * 0.11, h * 2);
  }
  ctx.restore();

  /* 磨砂玻璃的柔光斑 */
  for (i = 0; i < 26; i++) {
    var cx = rnd() * w;
    var cy = rnd() * h;
    var r = w * (0.06 + rnd() * 0.15);
    var dot = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    dot.addColorStop(0, 'rgba(255,255,250,0.28)');
    dot.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.fillStyle = dot;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  /* 窗外隐约的树叶影 */
  for (i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(128,148,108,0.09)';
    ctx.fillRect(rnd() * w, h * 0.42 + rnd() * h * 0.42, w * (0.10 + rnd() * 0.18), h * 0.09);
  }
}

/* 接地阴影贴片：一张柔和径向渐变，合并成一个透明批次 */
function paintShadow(ctx, w, h) {
  var grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ *
 * Static geometry batching: one mesh per material.
 * ------------------------------------------------------------------ */

function Batch(THREE) {
  this.THREE = THREE;
  this.parts = [];
}

Batch.prototype.add = function (geo, x, y, z, rx, ry, rz, su, sv) {
  var m = new this.THREE.Matrix4();
  m.makeRotationFromEuler(new this.THREE.Euler(rx || 0, ry || 0, rz || 0));
  m.setPosition(x, y, z);
  this.parts.push({
    geo: geo,
    m: m,
    su: isNum(su) ? su : 1,
    sv: isNum(sv) ? sv : 1
  });
  return this;
};

Batch.prototype.box = function (w, h, d, x, y, z) {
  return this.add(new this.THREE.BoxGeometry(w, h, d), x, y, z, 0, 0, 0, 1, 1);
};

Batch.prototype.cylinder = function (rTop, rBottom, height, segments, x, y, z) {
  return this.add(
    new this.THREE.CylinderGeometry(rTop, rBottom, height, segments),
    x, y, z, 0, 0, 0, 1, 1
  );
};

Batch.prototype.plane = function (w, h, x, y, z, rx, ry, su, sv) {
  return this.add(new this.THREE.PlaneGeometry(w, h), x, y, z, rx, ry, 0, su, sv);
};

Batch.prototype.build = function (material, name) {
  var parts = this.parts;
  if (!parts.length) {
    return null;
  }
  var pieces = [];
  var count = 0;
  var i, j, p, g, uv, converted;

  for (i = 0; i < parts.length; i++) {
    p = parts[i];
    g = p.geo;
    if (g.index) {
      converted = g.toNonIndexed();
      g.dispose();
      g = converted;
    }
    g.applyMatrix4(p.m);
    if (p.su !== 1 || p.sv !== 1) {
      uv = g.attributes.uv;
      if (uv) {
        for (j = 0; j < uv.array.length; j += 2) {
          uv.array[j] *= p.su;
          uv.array[j + 1] *= p.sv;
        }
        uv.needsUpdate = true;
      }
    }
    pieces.push(g);
    count += g.attributes.position.count;
  }

  var positions = new Float32Array(count * 3);
  var normals = new Float32Array(count * 3);
  var uvs = new Float32Array(count * 2);
  var offset = 0;

  for (i = 0; i < pieces.length; i++) {
    g = pieces[i];
    positions.set(g.attributes.position.array, offset * 3);
    if (g.attributes.normal) {
      normals.set(g.attributes.normal.array, offset * 3);
    }
    if (g.attributes.uv) {
      uvs.set(g.attributes.uv.array, offset * 2);
    }
    offset += g.attributes.position.count;
    g.dispose();
  }

  var merged = new this.THREE.BufferGeometry();
  merged.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new this.THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new this.THREE.BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();

  var mesh = new this.THREE.Mesh(merged, material);
  mesh.name = name || 'batch';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  this.parts.length = 0;
  return mesh;
};

/* ------------------------------------------------------------------ *
 * World
 * ------------------------------------------------------------------ */

function createWorld(THREE, opts) {
  if (!THREE || !THREE.Scene) {
    throw new Error('BathroomScene.createWorld: THREE is required');
  }
  opts = opts || {};
  var quality = opts.quality === 'low' ? 'low' : 'high';
  var eyeHeight = isNum(opts.eyeHeight) ? opts.eyeHeight : 1.7;
  var high = quality === 'high';
  var ringSeg = high ? 20 : 12;
  var tubeSeg = high ? 18 : 10;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 6, 16);

  var world = new THREE.Group();
  world.name = 'bathroom';
  world.userData.eyeHeight = eyeHeight;
  world.userData.quality = quality;
  scene.add(world);

  /* ---------------- lights (2 或 3, 无阴影贴图) ---------------- */
  var hemi = new THREE.HemisphereLight(0xfff7e8, 0x4a5045, 0.38);
  hemi.name = 'bathroom-hemi';
  world.add(hemi);

  var warmPoint = new THREE.PointLight(0xffe2bd, 1.25, 6.5, 2);
  warmPoint.name = 'bathroom-warm';
  warmPoint.position.set(0, 2.24, -0.35);
  world.add(warmPoint);

  if (high) {
    /* 磨砂窗透进来的日光，只在高画质点亮 */
    var windowLight = new THREE.PointLight(0xffedcf, 0.55, 4.2, 2);
    windowLight.name = 'bathroom-window';
    windowLight.position.set(-1.02, 1.72, WINDOW_Z);
    world.add(windowLight);
  }

  /* ---------------- textures ---------------- */
  var tileTex = createCanvasTexture(
    THREE,
    high ? 128 : 64,
    high ? 256 : 128,
    paintTile,
    true
  );
  var floorTex = high ? createCanvasTexture(THREE, 256, 256, paintFloor, true) : null;
  var woodTex = high ? createCanvasTexture(THREE, 128, 128, paintOak, true) : null;
  var mirrorTex = createCanvasTexture(
    THREE,
    high ? 128 : 64,
    high ? 128 : 64,
    paintMirror,
    false
  );
  var windowTex = createCanvasTexture(
    THREE,
    high ? 128 : 64,
    high ? 128 : 64,
    paintWindow,
    false
  );
  var shadowTex = high ? createCanvasTexture(THREE, 128, 128, paintShadow, false) : null;

  /* ---------------- materials ---------------- */
  var matTile = high
    ? new THREE.MeshStandardMaterial({
      color: tileTex ? 0xffffff : 0xe3e7d9,
      map: tileTex,
      roughness: 0.46,
      metalness: 0.0
    })
    : new THREE.MeshLambertMaterial({ color: 0xdfe3d4 });
  matTile.name = 'bathroom-wall-tile';

  var matFloor = high
    ? new THREE.MeshStandardMaterial({
      color: floorTex ? 0xffffff : 0x9aa396,
      map: floorTex,
      roughness: 0.86,
      metalness: 0.0
    })
    : new THREE.MeshLambertMaterial({ color: 0x98a294 });
  matFloor.name = 'bathroom-nonslip-floor';

  /* 天花朝下，主光吃不均匀，用不受光材质保持干净 */
  var matCeiling = new THREE.MeshBasicMaterial({ color: 0xe3e6da });
  matCeiling.name = 'bathroom-ceiling';

  var matWood = high
    ? new THREE.MeshStandardMaterial({
      color: woodTex ? 0xffffff : 0xcdb086,
      map: woodTex,
      roughness: 0.6,
      metalness: 0.0
    })
    : new THREE.MeshLambertMaterial({ color: 0xc7aa80 });
  matWood.name = 'bathroom-oak';

  var matCeramic = new THREE.MeshStandardMaterial({
    color: 0xf2f1ea, roughness: 0.17, metalness: 0.02
  });
  matCeramic.name = 'bathroom-ceramic';

  /* 立起的盖板背向暖光：独立材质带一点自发光托底，仍保留釉面高光 */
  var matLid = new THREE.MeshStandardMaterial({
    color: 0xf7f5ef,
    roughness: 0.26,
    metalness: 0.0,
    emissive: 0xdcd8cc,
    emissiveIntensity: 0.28
  });
  matLid.name = 'bathroom-toilet-lid';

  /* 无环境贴图时高金属度会发黑：压低 metalness，靠粗糙度做出拉丝感 */
  var matMetal = new THREE.MeshStandardMaterial({
    color: 0xc9cec9, roughness: 0.45, metalness: 0.25
  });
  matMetal.name = 'bathroom-metal';

  /* 可注视扶手单独一份材质：闪烁放大时不会牵动整批金属件 */
  var matBar = new THREE.MeshStandardMaterial({
    color: 0xc9cec9, roughness: 0.45, metalness: 0.25
  });
  matBar.name = 'bathroom-grab-bar';

  var matSkirt = new THREE.MeshStandardMaterial({
    color: 0x929a8e, roughness: 0.62, metalness: 0.0
  });
  matSkirt.name = 'bathroom-skirting';

  var matMirror = new THREE.MeshBasicMaterial({
    color: mirrorTex ? 0xffffff : 0xdfe3d7,
    map: mirrorTex
  });
  matMirror.name = 'bathroom-mirror';

  var matWater = new THREE.MeshStandardMaterial({
    color: 0xa9c0c0,
    roughness: 0.08,
    metalness: 0.04,
    transparent: true,
    opacity: 0.72,
    depthWrite: false
  });
  matWater.name = 'bathroom-water';

  var matLinen = new THREE.MeshStandardMaterial({
    color: 0xdfe2d4, roughness: 0.94, metalness: 0.0
  });
  matLinen.name = 'bathroom-linen';

  var matBin = new THREE.MeshStandardMaterial({
    color: 0x7f8d7c, roughness: 0.72, metalness: 0.0
  });
  matBin.name = 'bathroom-bin';

  var matCall = new THREE.MeshStandardMaterial({
    color: 0xb44f45, roughness: 0.5, metalness: 0.02
  });
  matCall.name = 'bathroom-call-unit';

  var matLeaves = new THREE.MeshStandardMaterial({
    color: 0x6f8a63,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
  matLeaves.name = 'bathroom-plant';

  var matGlow = new THREE.MeshBasicMaterial({ color: 0xfff2da });
  matGlow.name = 'bathroom-glow';

  var matWindow = new THREE.MeshBasicMaterial({
    color: windowTex ? 0xffffff : 0xffeed2,
    map: windowTex
  });
  matWindow.name = 'bathroom-window';

  var matShadow = null;
  if (shadowTex) {
    matShadow = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: shadowTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false
    });
    matShadow.name = 'bathroom-contact-shadow';
  }

  /* ---------------- shell: floor, tiled walls, ceiling ---------------- */
  var floorBatch = new Batch(THREE);
  floorBatch.plane(ROOM_W, ROOM_D, 0, 0, 0, -Math.PI / 2, 0, ROOM_W, ROOM_D);
  var floorMesh = floorBatch.build(matFloor, 'bathroom-floor');
  if (floorMesh) { world.add(floorMesh); }

  var wallBatch = new Batch(THREE);
  var wallU = ROOM_W / TILE_W;
  var wallV = ROOM_H / TILE_H;
  wallBatch.plane(ROOM_W, ROOM_H, 0, ROOM_H / 2, -ROOM_D / 2, 0, 0, wallU, wallV);             /* 后墙 */
  wallBatch.plane(ROOM_D, ROOM_H, -ROOM_W / 2, ROOM_H / 2, 0, 0, Math.PI / 2, ROOM_D / TILE_W, wallV);  /* 左墙 */
  wallBatch.plane(ROOM_D, ROOM_H, ROOM_W / 2, ROOM_H / 2, 0, 0, -Math.PI / 2, ROOM_D / TILE_W, wallV);  /* 右墙 */
  wallBatch.plane(ROOM_W, ROOM_H, 0, ROOM_H / 2, ROOM_D / 2, 0, Math.PI, wallU, wallV);        /* 前墙（镜头外侧，单面剔除） */
  var wallMesh = wallBatch.build(matTile, 'bathroom-walls');
  if (wallMesh) { world.add(wallMesh); }

  var ceilingBatch = new Batch(THREE);
  ceilingBatch.plane(ROOM_W, ROOM_D, 0, ROOM_H, 0, Math.PI / 2, 0, 1, 1);
  var ceilingMesh = ceilingBatch.build(matCeiling, 'bathroom-ceiling-mesh');
  if (ceilingMesh) { world.add(ceilingMesh); }

  /* ---------------- batches ---------------- */
  var wood = new Batch(THREE);
  var ceramic = new Batch(THREE);
  var metal = new Batch(THREE);
  var linen = new Batch(THREE);
  var glow = new Batch(THREE);
  var bin = new Batch(THREE);
  var skirt = new Batch(THREE);

  /* ============ 踢脚：一条深鼠尾草灰细带，压住墙地交界 ============ */
  skirt.box(ROOM_W, 0.08, 0.012, 0, 0.04, -ROOM_D / 2 + 0.006);
  skirt.box(ROOM_W, 0.08, 0.012, 0, 0.04, ROOM_D / 2 - 0.006);
  skirt.box(0.012, 0.08, ROOM_D, -ROOM_W / 2 + 0.006, 0.04, 0);
  skirt.box(0.012, 0.08, ROOM_D, ROOM_W / 2 - 0.006, 0.04, 0);

  /* ============ 洗手台（后墙左侧，壁挂式） ============ */
  wood.box(0.48, 0.34, 0.32, VANITY_X, 0.62, VANITY_Z);               /* 柜体：y 0.45 - 0.79 */
  wood.box(0.42, 0.26, 0.018, VANITY_X, 0.62, VANITY_Z + 0.17);       /* 柜门 */
  metal.box(0.14, 0.012, 0.016, VANITY_X, 0.74, VANITY_Z + 0.181);    /* 拉手 */
  wood.box(0.54, 0.04, 0.37, VANITY_X, COUNTER_H - 0.02, VANITY_Z + 0.015); /* 台面 */

  /* 陶瓷台上盆 + 墙出龙头 */
  ceramic.cylinder(0.15, 0.115, 0.095, ringSeg, VANITY_X, COUNTER_H + 0.0475, VANITY_Z + 0.03);
  var basinRim = new THREE.TorusGeometry(0.145, 0.009, 6, ringSeg);
  ceramic.add(basinRim, VANITY_X, COUNTER_H + 0.095, VANITY_Z + 0.03, Math.PI / 2, 0, 0, 1, 1);
  metal.add(
    new THREE.CylinderGeometry(0.016, 0.016, 0.14, 12),
    VANITY_X, COUNTER_H + 0.17, VANITY_Z - 0.07, Math.PI / 2, 0, 0, 1, 1
  );
  metal.cylinder(0.012, 0.012, 0.05, 10, VANITY_X, COUNTER_H + 0.145, VANITY_Z - 0.005);
  metal.box(0.07, 0.014, 0.02, VANITY_X + 0.04, COUNTER_H + 0.185, VANITY_Z - 0.07);

  /* 皂液瓶 */
  ceramic.cylinder(0.032, 0.036, 0.12, 14, VANITY_X - 0.22, COUNTER_H + 0.06, VANITY_Z + 0.06);
  metal.cylinder(0.008, 0.008, 0.05, 8, VANITY_X - 0.22, COUNTER_H + 0.14, VANITY_Z + 0.06);
  metal.box(0.04, 0.008, 0.012, VANITY_X - 0.205, COUNTER_H + 0.165, VANITY_Z + 0.06);

  /* 台面右侧叠好的手巾：唯一的织物暖点 */
  linen.box(0.11, 0.045, 0.11, VANITY_X + 0.21, COUNTER_H + 0.0225, VANITY_Z + 0.14);
  linen.box(0.09, 0.03, 0.09, VANITY_X + 0.21, COUNTER_H + 0.06, VANITY_Z + 0.14);

  /* 镜框（浅橡木）+ 镜面（可注视） */
  wood.box(0.52, 0.03, 0.03, VANITY_X, 1.17, -1.478);
  wood.box(0.52, 0.03, 0.03, VANITY_X, 1.87, -1.478);
  wood.box(0.03, 0.73, 0.03, VANITY_X - 0.245, 1.52, -1.478);
  wood.box(0.03, 0.73, 0.03, VANITY_X + 0.245, 1.52, -1.478);

  var mirrorMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.68), matMirror);
  mirrorMesh.name = 'bathroom-mirror';
  mirrorMesh.position.set(VANITY_X, 1.52, -1.487);
  mirrorMesh.userData.selectable = true;
  mirrorMesh.userData.targetId = 1;
  mirrorMesh.userData.label = 'mirror';
  world.add(mirrorMesh);

  /* 镜前柔光灯条 */
  glow.box(0.36, 0.045, 0.02, VANITY_X, 1.945, -1.474);

  /* ============ 马桶（后墙正中，面朝 +z，患者正前方） ============ */
  var baseGeo = new THREE.CylinderGeometry(0.155, 0.13, 0.16, tubeSeg);
  baseGeo.scale(1, 1, 1.12);
  ceramic.add(baseGeo, WC_X, 0.08, WC_Z - 0.01, 0, 0, 0, 1, 1);      /* 收腰底座，落地 */
  var bowlGeo = new THREE.CylinderGeometry(0.188, 0.125, 0.3, tubeSeg);
  bowlGeo.scale(1, 1, 1.28);
  ceramic.add(bowlGeo, WC_X, 0.27, WC_Z, 0, 0, 0, 1, 1);

  var bowlRim = new THREE.TorusGeometry(0.176, 0.028, 6, tubeSeg);
  bowlRim.scale(1, 1.28, 1);
  ceramic.add(bowlRim, WC_X, 0.425, WC_Z, Math.PI / 2, 0, 0, 1, 1);

  var seat = new THREE.TorusGeometry(0.168, 0.032, 6, tubeSeg);
  seat.scale(1, 1.28, 1);
  ceramic.add(seat, WC_X, 0.455, WC_Z, Math.PI / 2, 0, 0, 1, 1);

  /* 座圈外缘的细暗缝：让白色座圈与白色碗体分开 */
  var seatSeam = new THREE.TorusGeometry(0.199, 0.003, 4, tubeSeg);
  seatSeam.scale(1, 1.28, 1);
  skirt.add(seatSeam, WC_X, 0.444, WC_Z, Math.PI / 2, 0, 0, 1, 1);

  /* 立起的盖板：独立网格，带一圈圆边和内侧细缝，避免读成一块灰盘 */
  var lidBatch = new Batch(THREE);
  var lidGeo = new THREE.CylinderGeometry(0.176, 0.176, 0.02, tubeSeg);
  lidGeo.scale(1, 1, 1.28);
  lidBatch.add(lidGeo, 0, 0, 0, -1.35, 0, 0, 1, 1);

  var lidRimGeo = new THREE.TorusGeometry(0.176, 0.006, 5, tubeSeg);
  lidRimGeo.rotateX(Math.PI / 2);
  lidRimGeo.scale(1, 1, 1.28);
  lidBatch.add(lidRimGeo, 0, 0, 0, -1.35, 0, 0, 1, 1);

  var lidMesh = lidBatch.build(matLid, 'bathroom-toilet-lid');
  lidMesh.position.set(WC_X, 0.7, -1.23);
  /* 合批网格默认关闭矩阵自更新；盖板有自身位移，需要恢复 */
  lidMesh.matrixAutoUpdate = true;
  lidMesh.updateMatrix();
  world.add(lidMesh);

  /* 盖板正面的细缝：深灰绿椭圆线，给盘面一个内边界 */
  var lidSeamGeo = new THREE.TorusGeometry(0.152, 0.0025, 4, tubeSeg);
  lidSeamGeo.rotateX(Math.PI / 2);
  lidSeamGeo.scale(1, 1, 1.28);
  lidSeamGeo.translate(0, -0.012, 0);
  skirt.add(lidSeamGeo, WC_X, 0.7, -1.23, -1.35, 0, 0, 1, 1);

  /* 水箱：降低到病床扶手高度以下，盖板略出挑 */
  ceramic.box(0.4, 0.38, 0.2, WC_X, 0.79, -1.39);
  ceramic.box(0.435, 0.035, 0.215, WC_X, 0.9975, -1.385);

  /* 箱盖上的内凹冲水面板 + 双按键：开盖时不遮挡，也打破白箱的空白 */
  skirt.box(0.24, 0.012, 0.12, WC_X, 1.017, -1.385);
  metal.cylinder(0.026, 0.026, 0.012, 12, WC_X - 0.05, 1.028, -1.385);
  metal.cylinder(0.02, 0.02, 0.012, 10, WC_X + 0.05, 1.028, -1.385);
  /* 箱盖出挑下的细阴影线，让盖沿不再是白上加白 */
  skirt.box(0.44, 0.006, 0.005, WC_X, 0.978, -1.278);

  metal.box(0.04, 0.03, 0.05, WC_X - 0.1, 0.475, -1.245);
  metal.box(0.04, 0.03, 0.05, WC_X + 0.1, 0.475, -1.245);

  /* 内水面：单独一层，可做极轻的浮动 */
  var waterGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.004, tubeSeg);
  waterGeo.scale(1, 1, 1.25);
  var waterMesh = new THREE.Mesh(waterGeo, matWater);
  waterMesh.name = 'bathroom-water';
  waterMesh.position.set(WC_X, WATER_Y, WC_Z);
  world.add(waterMesh);

  /* ============ 无障碍扶手：马桶两侧（后墙）============ */
  /* 左侧扶手进金属批次；右侧单独成网，作为可注视目标 */
  function addBarParts(batch, cx, cy, cz) {
    batch.add(new THREE.CylinderGeometry(0.018, 0.018, 0.38, 16), cx, cy, cz, 0, 0, Math.PI / 2, 1, 1);
    batch.add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10), cx - 0.19, cy, cz - 0.034, Math.PI / 2, 0, 0, 1, 1);
    batch.add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10), cx + 0.19, cy, cz - 0.034, Math.PI / 2, 0, 0, 1, 1);
    batch.add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), cx - 0.19, cy, cz - 0.052, Math.PI / 2, 0, 0, 1, 1);
    batch.add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), cx + 0.19, cy, cz - 0.052, Math.PI / 2, 0, 0, 1, 1);
  }

  addBarParts(metal, -0.62, 0.9, -1.415);

  var barBatch = new Batch(THREE);
  barBatch.add(new THREE.CylinderGeometry(0.018, 0.018, 0.38, 16), 0, 0, 0, 0, 0, Math.PI / 2, 1, 1);
  barBatch.add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10), -0.19, 0, -0.034, Math.PI / 2, 0, 0, 1, 1);
  barBatch.add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10), 0.19, 0, -0.034, Math.PI / 2, 0, 0, 1, 1);
  barBatch.add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), -0.19, 0, -0.052, Math.PI / 2, 0, 0, 1, 1);
  barBatch.add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), 0.19, 0, -0.052, Math.PI / 2, 0, 0, 1, 1);
  var grabBarMesh = barBatch.build(matBar, 'bathroom-grab-bar');
  grabBarMesh.position.set(0.62, 0.9, -1.415);
  /* 合批网格默认关闭矩阵自更新；这个目标有自身位移，需要恢复 */
  grabBarMesh.matrixAutoUpdate = true;
  grabBarMesh.updateMatrix();
  grabBarMesh.userData.selectable = true;
  grabBarMesh.userData.targetId = 2;
  grabBarMesh.userData.label = 'grab-bar';
  world.add(grabBarMesh);

  /* 湿区侧墙的连续扶手（站立与转身用） */
  metal.add(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 16), 1.355, 0.95, 0.3, Math.PI / 2, 0, 0, 1, 1);
  metal.add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), 1.383, 0.95, 0.0, 0, 0, Math.PI / 2, 1, 1);
  metal.add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), 1.383, 0.95, 0.6, 0, 0, Math.PI / 2, 1, 1);
  metal.add(new THREE.CylinderGeometry(0.014, 0.014, 0.025, 10), 1.371, 0.95, 0.0, 0, 0, Math.PI / 2, 1, 1);
  metal.add(new THREE.CylinderGeometry(0.014, 0.014, 0.025, 10), 1.371, 0.95, 0.6, 0, 0, Math.PI / 2, 1, 1);

  /* ============ 紧急呼叫（呼叫面板 + 拉绳，位于马桶左侧） ============ */
  ceramic.box(0.135, 0.18, 0.012, -0.32, 1.34, -1.478);               /* 白色底板 */
  ceramic.cylinder(0.018, 0.018, 0.014, 12, -0.32, 1.375, -1.452);    /* 呼叫按钮 */

  var callBatch = new Batch(THREE);
  callBatch.box(0.11, 0.15, 0.016, 0, 0, 0);
  callBatch.cylinder(0.004, 0.004, 0.52, 6, 0, -0.335, 0.016);
  callBatch.add(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 10), 0, -0.6, 0.016, 0, 0, Math.PI / 2, 1, 1);
  var callMesh = callBatch.build(matCall, 'bathroom-call-button');
  callMesh.position.set(-0.32, 1.34, -1.466);
  /* 合批网格默认关闭矩阵自更新；这个目标有自身位移，需要恢复 */
  callMesh.matrixAutoUpdate = true;
  callMesh.updateMatrix();
  callMesh.userData.selectable = true;
  callMesh.userData.targetId = 3;
  callMesh.userData.label = 'call-button';
  world.add(callMesh);

  /* ============ 卫生纸架（右侧扶手下方） ============ */
  metal.box(0.05, 0.09, 0.012, 0.62, 0.62, -1.492);
  metal.add(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 10), 0.56, 0.62, -1.44, Math.PI / 2, 0, 0, 1, 1);
  metal.add(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 10), 0.68, 0.62, -1.44, Math.PI / 2, 0, 0, 1, 1);
  metal.add(new THREE.CylinderGeometry(0.007, 0.007, 0.14, 10), 0.62, 0.62, -1.4, 0, 0, Math.PI / 2, 1, 1);
  ceramic.add(new THREE.CylinderGeometry(0.052, 0.052, 0.1, 16), 0.62, 0.62, -1.4, 0, 0, Math.PI / 2, 1, 1);

  /* ============ 污物桶（马桶右侧地面） ============ */
  bin.cylinder(0.105, 0.095, 0.34, ringSeg, 0.52, 0.17, -1.2);
  bin.cylinder(0.112, 0.108, 0.03, ringSeg, 0.52, 0.355, -1.2);
  metal.box(0.16, 0.018, 0.05, 0.52, 0.025, -1.06);

  /* ============ 免洗消毒液（左墙，窗边） ============ */
  ceramic.box(0.075, 0.2, 0.1, -1.3625, 1.1, 0.62);
  metal.cylinder(0.012, 0.012, 0.06, 10, -1.34, 1.235, 0.62);
  metal.box(0.06, 0.014, 0.02, -1.31, 1.25, 0.62);
  ceramic.box(0.06, 0.012, 0.09, -1.34, 0.985, 0.62);

  /* ============ 置物架 + 小植物（右后墙，非交互） ============ */
  wood.box(0.5, 0.035, 0.18, 1.02, 1.5, -1.4);
  metal.box(0.03, 0.1, 0.06, 0.86, 1.447, -1.455);
  metal.box(0.03, 0.1, 0.06, 1.18, 1.447, -1.455);

  ceramic.cylinder(0.06, 0.046, 0.12, 16, 1.02, 1.58, -1.4);
  ceramic.cylinder(0.064, 0.061, 0.02, 16, 1.02, 1.645, -1.4);
  ceramic.cylinder(0.03, 0.034, 0.13, 14, 0.87, 1.585, -1.4);
  ceramic.cylinder(0.024, 0.028, 0.1, 12, 1.17, 1.57, -1.4);
  metal.cylinder(0.016, 0.016, 0.02, 10, 0.87, 1.66, -1.4);
  metal.cylinder(0.013, 0.013, 0.018, 10, 1.17, 1.63, -1.4);

  /* 叶片：整株合成一张网格，可整体轻摆 */
  var plant = new Batch(THREE);
  var leafRnd = seeded(0x7ab1e5);
  var li;
  for (li = 0; li < 9; li++) {
    /* 叶片朝房间一侧展开：像植物朝光生长，也不插进背后墙面 */
    var ang = Math.PI / 2 + (li - 4) * 0.32 + leafRnd() * 0.12;
    var stemIn = 0.01 + leafRnd() * 0.016;
    var reach = 0.055 + leafRnd() * 0.05;
    plant.cylinder(
      0.004, 0.0045, 0.1 + leafRnd() * 0.05, 5,
      Math.cos(ang) * stemIn, 0.06, Math.sin(ang) * stemIn
    );
    plant.plane(
      0.065, 0.13,
      Math.cos(ang) * reach, 0.16 + leafRnd() * 0.045, Math.sin(ang) * reach,
      -0.95 - leafRnd() * 0.3, ang,
      1, 1
    );
  }
  var leavesMesh = plant.build(matLeaves, 'bathroom-plant-leaves');
  leavesMesh.position.set(1.02, 1.65, -1.4);
  /* 这一株要轻摆，必须恢复矩阵自更新（合批网格默认是静态的） */
  leavesMesh.matrixAutoUpdate = true;
  leavesMesh.updateMatrix();
  world.add(leavesMesh);

  /* ============ 磨砂窗（左墙） ============ */
  var windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.0), matWindow);
  windowMesh.name = 'bathroom-frosted-window';
  windowMesh.position.set(-ROOM_W / 2 + 0.006, 1.62, WINDOW_Z);
  windowMesh.rotation.y = Math.PI / 2;
  world.add(windowMesh);

  wood.box(0.035, 0.05, 1.02, -ROOM_W / 2 + 0.017, 2.145, WINDOW_Z);
  wood.box(0.035, 0.05, 1.02, -ROOM_W / 2 + 0.017, 1.095, WINDOW_Z);
  wood.box(0.035, 1.1, 0.05, -ROOM_W / 2 + 0.017, 1.62, WINDOW_Z + 0.47);
  wood.box(0.035, 1.1, 0.05, -ROOM_W / 2 + 0.017, 1.62, WINDOW_Z - 0.47);
  wood.box(0.1, 0.035, 1.08, -ROOM_W / 2 + 0.04, 1.075, WINDOW_Z);

  /* ============ 湿区（右前）：线性地漏 + 花洒 + 折叠淋浴椅 ============ */
  /* 无挡水条：整间地面连续，地漏贴墙 */
  metal.box(0.06, 0.004, 0.7, 1.2, 0.002, 0.45);

  metal.add(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 12), 1.368, 1.42, 0.75, 0, 0, 0, 1, 1);
  metal.box(0.035, 0.03, 0.04, 1.383, 1.82, 0.75);
  metal.box(0.035, 0.03, 0.04, 1.383, 1.02, 0.75);
  metal.box(0.03, 0.08, 0.04, 1.34, 1.2, 0.75);
  metal.cylinder(0.055, 0.045, 0.022, ringSeg, 1.29, 1.28, 0.75);

  /* 折叠淋浴椅：浅橡木条板 + 金属托架 */
  wood.box(0.34, 0.028, 0.075, 1.22, 0.5, -0.045);
  wood.box(0.34, 0.028, 0.075, 1.22, 0.5, 0.055);
  wood.box(0.34, 0.028, 0.075, 1.22, 0.5, 0.155);
  wood.box(0.34, 0.028, 0.075, 1.22, 0.5, 0.255);
  metal.box(0.04, 0.12, 0.06, 1.385, 0.42, -0.02);
  metal.box(0.04, 0.12, 0.06, 1.385, 0.42, 0.22);

  /* ============ 毛巾杆（右墙，湿区之外） ============ */
  metal.add(new THREE.CylinderGeometry(0.011, 0.011, 0.36, 10), 1.36, 1.2, 1.15, Math.PI / 2, 0, 0, 1, 1);
  metal.box(0.03, 0.03, 0.03, 1.383, 1.2, 0.98);
  metal.box(0.03, 0.03, 0.03, 1.383, 1.2, 1.32);
  linen.box(0.05, 0.42, 0.28, 1.33, 0.99, 1.15);

  /* ============ 门（前墙右半，转身可见） ============ */
  wood.box(0.82, 2.02, 0.045, 0.55, 1.01, 1.475);
  wood.box(0.05, 2.1, 0.03, 0.11, 1.05, 1.478);
  wood.box(0.05, 2.1, 0.03, 0.99, 1.05, 1.478);
  wood.box(0.93, 0.05, 0.03, 0.55, 2.1, 1.478);
  metal.add(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), 0.9, 1.03, 1.44);
  metal.box(0.09, 0.018, 0.018, 0.855, 1.03, 1.443);

  /* ============ 顶灯（暖光盘） ============ */
  metal.cylinder(0.19, 0.19, 0.016, ringSeg, 0, ROOM_H - 0.008, -0.3);
  glow.cylinder(0.168, 0.168, 0.012, ringSeg, 0, ROOM_H - 0.02, -0.3);

  /* ---------------- 接地阴影：单批次透明贴片 ---------------- */
  if (shadowTex) {
    var shadows = new Batch(THREE);
    shadows.plane(0.95, 1.05, WC_X, 0.004, WC_Z - 0.05, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.7, 0.5, VANITY_X, 0.004, VANITY_Z + 0.02, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.3, 0.3, 0.52, 0.004, -1.2, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.45, 0.5, 1.22, 0.004, 0.1, -Math.PI / 2, 0, 1, 1);
    var shadowMesh = shadows.build(matShadow, 'bathroom-contact-shadows');
    if (shadowMesh) {
      shadowMesh.renderOrder = 1;
      world.add(shadowMesh);
    }
  }

  /* ---------------- 合批出图 ---------------- */
  var woodMesh = wood.build(matWood, 'bathroom-wood-batch');
  if (woodMesh) { world.add(woodMesh); }
  var ceramicMesh = ceramic.build(matCeramic, 'bathroom-ceramic-batch');
  if (ceramicMesh) { world.add(ceramicMesh); }
  var metalMesh = metal.build(matMetal, 'bathroom-metal-batch');
  if (metalMesh) { world.add(metalMesh); }
  var linenMesh = linen.build(matLinen, 'bathroom-linen-batch');
  if (linenMesh) { world.add(linenMesh); }
  var glowMesh = glow.build(matGlow, 'bathroom-glow-batch');
  if (glowMesh) { world.add(glowMesh); }
  var binMesh = bin.build(matBin, 'bathroom-bin-mesh');
  if (binMesh) { world.add(binMesh); }
  var skirtMesh = skirt.build(matSkirt, 'bathroom-skirting');
  if (skirtMesh) { world.add(skirtMesh); }

  /* ---------------- 交互目标 ---------------- */
  var selectables = [mirrorMesh, grabBarMesh, callMesh];

  /* ---------------- 预算统计（供设备侧核对） ---------------- */
  var triangleCount = 0;
  var drawCalls = 0;
  var textureBytes = 0;
  var textureCount = 0;

  scene.traverse(function (obj) {
    if (!obj.isMesh) {
      return;
    }
    drawCalls++;
    var geo = obj.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) {
      return;
    }
    var tris = geo.index
      ? geo.index.count / 3
      : geo.attributes.position.count / 3;
    triangleCount += tris;
  });

  var textureList = [tileTex, floorTex, woodTex, mirrorTex, windowTex, shadowTex];
  var tx;
  for (tx = 0; tx < textureList.length; tx++) {
    if (textureList[tx] && textureList[tx].image) {
      textureCount++;
      textureBytes += Math.round(
        textureList[tx].image.width * textureList[tx].image.height * 4 * (4 / 3)
      );
    }
  }

  var stats = {
    triangles: Math.round(triangleCount),
    drawCalls: drawCalls,
    meshes: drawCalls,
    lights: high ? 3 : 2,
    textures: textureCount,
    textureBytes: textureBytes,
    quality: quality
  };
  world.userData.stats = stats;

  if (typeof console !== 'undefined' && console.log) {
    console.log('[BathroomScene]', quality, stats);
  }

  /* ---------------- animation ---------------- */
  var clock = 0;
  var disposed = false;

  function update(dt) {
    if (disposed) {
      return;
    }
    if (!isNum(dt) || dt < 0) {
      dt = 0;
    }
    if (dt > 0.1) {
      dt = 0.1;
    }
    clock += dt;

    /* 只有角度/位置/透明度变化：每帧零分配 */
    leavesMesh.rotation.z = Math.sin(clock * 0.85) * 0.026;
    leavesMesh.rotation.x = Math.sin(clock * 0.53 + 1.1) * 0.015;
    waterMesh.position.y = WATER_Y + Math.sin(clock * 1.25) * 0.001;
    matWater.opacity = 0.72 + Math.sin(clock * 0.9) * 0.035;
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    var seenTextures = [];
    scene.traverse(function (obj) {
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      var mats = obj.material
        ? (Array.isArray(obj.material) ? obj.material : [obj.material])
        : [];
      var mi, m;
      for (mi = 0; mi < mats.length; mi++) {
        m = mats[mi];
        if (m.map && seenTextures.indexOf(m.map) === -1) {
          seenTextures.push(m.map);
          m.map.dispose();
        }
        m.dispose();
      }
    });
    while (world.children.length) {
      world.remove(world.children[0]);
    }
    scene.remove(world);
    scene.background = null;
    scene.fog = null;
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

export { createWorld, VERSION };
