/*!
 * BathroomScene 1.0.0
 * Procedural quiet home bathroom for Three.js 0.152 (PICO G2 4K / Firefox Reality 10).
 *
 * ES module (ES5 syntax inside). Exports createWorld and VERSION; no globals.
 *
 * Contract:
 *   var built = createWorld(THREE, { quality: 'high', eyeHeight: 1.6 });
 *   built.scene        THREE.Scene
 *   built.world        THREE.Group containing every mesh and light (floor at local y = 0)
 *   built.update(dt)   cheap animation tick, seconds; allocates nothing
 *   built.selectables  array of 3 Meshes with userData.selectable === true
 *                      (mirror, plant, grab bar)
 *   built.dispose()    releases geometries, materials and generated textures
 *
 * The room is authored at real-world scale so WebXR `local` space can be fixed with
 *   world.position.y = -world.userData.eyeHeight;
 * while a 2D preview keeps world.position.y = 0. The user stands at the local
 * origin facing -z: washbasin and mirror ahead on the left, toilet ahead on the
 * right, walk-in shower at the front right.
 */
var VERSION = '1.0.0';
var BG_COLOR = 0x171310;
var FOG_COLOR = 0x171310;

/* 房间尺寸（米） */
var ROOM_W = 2.8;   /* x 方向 */
var ROOM_D = 3.0;   /* z 方向 */
var ROOM_H = 2.55;  /* 层高 */

/* 大规格墙砖：0.6 m 宽 x 1.2 m 高，一张纹理正好一块 */
var TILE_W = 0.6;
var TILE_H = 1.2;

/* 洗手台 */
var VANITY_X = -0.72;
var VANITY_Z = -1.24;
var COUNTER_H = 0.825;

/* 马桶（面朝 +z，即面向用户） */
var WC_X = 0.78;
var WC_Z = -1.05;
var WATER_Y = 0.452;

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

/* 暖米色大砖：一砖一纹理，四周留 2% 缝，表面有轻微色差与矿物斑点 */
function paintTile(ctx, w, h) {
  var rnd = seeded(0x6a3d19);
  var i, g;
  var padX = Math.max(2, Math.round(w * 0.022));
  var padY = Math.max(3, Math.round(h * 0.022));

  /* 缝底色 */
  ctx.fillStyle = '#b7a897';
  ctx.fillRect(0, 0, w, h);

  /* 砖面：竖向缓变，模拟整砖釉面的柔和光泽 */
  g = ctx.createLinearGradient(0, padY, 0, h - padY);
  g.addColorStop(0, '#e7dccb');
  g.addColorStop(0.45, '#e0d3c0');
  g.addColorStop(1, '#d7c8b4');
  ctx.fillStyle = g;
  ctx.fillRect(padX, padY, w - padX * 2, h - padY * 2);

  /* 大面积云状色差 */
  for (i = 0; i < 26; i++) {
    var cx = padX + rnd() * (w - padX * 2);
    var cy = padY + rnd() * (h - padY * 2);
    var rr = 8 + rnd() * w * 0.22;
    var blob = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    var dark = rnd() < 0.5;
    blob.addColorStop(0, dark ? 'rgba(176,158,134,0.10)' : 'rgba(255,250,240,0.12)');
    blob.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
  }

  /* 细矿物斑点 */
  for (i = 0; i < 520; i++) {
    ctx.fillStyle = 'rgba(150,132,110,' + (0.03 + rnd() * 0.05).toFixed(3) + ')';
    ctx.fillRect(padX + rnd() * (w - padX * 2), padY + rnd() * (h - padY * 2), 1, 1 + rnd());
  }

  /* 砖沿的倒角高光与内侧阴影，让缝有厚度 */
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fillRect(padX, padY, w - padX * 2, 2);
  ctx.fillRect(padX, padY, 2, h - padY * 2);
  ctx.fillStyle = 'rgba(120,104,86,0.28)';
  ctx.fillRect(padX, h - padY - 2, w - padX * 2, 2);
  ctx.fillRect(w - padX - 2, padY, 2, h - padY * 2);
}

/* 石材地面：暖灰石灰岩，细颗粒 + 极淡云纹，1 m 见方，可无缝平铺 */
function paintStone(ctx, w, h) {
  var rnd = seeded(0x21b47d);
  var i, x, y, r, g2;
  g2 = ctx.createLinearGradient(0, 0, w, h);
  g2.addColorStop(0, '#cdc3b5');
  g2.addColorStop(0.5, '#c6bcad');
  g2.addColorStop(1, '#cbc1b3');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);

  /* 云状色块（四角重复，保证平铺接缝不突兀） */
  for (i = 0; i < 40; i++) {
    x = rnd() * w;
    y = rnd() * h;
    r = 14 + rnd() * w * 0.2;
    var cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
    cloud.addColorStop(0, rnd() < 0.55 ? 'rgba(160,148,132,0.09)' : 'rgba(240,234,224,0.10)');
    cloud.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* 细颗粒 */
  for (i = 0; i < 2600; i++) {
    ctx.fillStyle = 'rgba(120,108,94,' + (0.03 + rnd() * 0.09).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1);
  }
  for (i = 0; i < 1200; i++) {
    ctx.fillStyle = 'rgba(255,252,244,' + (0.03 + rnd() * 0.08).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }

  /* 石脉：短促、走向随机，避免跨越贴图边界 */
  ctx.lineWidth = 1;
  for (i = 0; i < 14; i++) {
    var sx = 12 + rnd() * (w - 24);
    var sy = 12 + rnd() * (h - 24);
    var len = 10 + rnd() * 40;
    var ang = rnd() * Math.PI;
    ctx.strokeStyle = 'rgba(148,134,118,' + (0.10 + rnd() * 0.12).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    ctx.stroke();
  }
}

/* 暖胡桃木：竖向木纹（v 方向），带细密纹理与少量结疤 */
function paintWood(ctx, w, h) {
  var rnd = seeded(0x4f0c2e);
  var i, x, y;
  var g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#9a6a46');
  g.addColorStop(0.5, '#a4734d');
  g.addColorStop(1, '#94643f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* 顺纹长线：沿 y 走，x 上做正弦扰动 */
  for (i = 0; i < 46; i++) {
    x = rnd() * w;
    var amp = 1 + rnd() * 2.4;
    var freq = 0.02 + rnd() * 0.03;
    var phase = rnd() * Math.PI * 2;
    ctx.strokeStyle = rnd() < 0.5
      ? 'rgba(92,58,34,' + (0.10 + rnd() * 0.20).toFixed(3) + ')'
      : 'rgba(196,150,108,' + (0.08 + rnd() * 0.16).toFixed(3) + ')';
    ctx.lineWidth = 0.6 + rnd() * 1.5;
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

  /* 结疤 */
  for (i = 0; i < 3; i++) {
    var kx = 8 + rnd() * (w - 16);
    var ky = 8 + rnd() * (h - 16);
    ctx.strokeStyle = 'rgba(84,52,30,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(kx, ky, 2 + rnd() * 2.5, 4 + rnd() * 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* 细木孔 */
  for (i = 0; i < 900; i++) {
    ctx.fillStyle = 'rgba(72,46,28,' + (0.02 + rnd() * 0.05).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 2);
  }
}

/* 防滑垫：暖沙色横纹，四周深色包边 */
function paintMat(ctx, w, h) {
  var rnd = seeded(0x3c9e51);
  var i, y;
  ctx.fillStyle = '#d3c4ad';
  ctx.fillRect(0, 0, w, h);

  for (y = 0; y < h; y += 10) {
    ctx.fillStyle = 'rgba(255,250,240,0.16)';
    ctx.fillRect(0, y, w, 4);
    ctx.fillStyle = 'rgba(150,130,104,0.16)';
    ctx.fillRect(0, y + 6, w, 2);
  }

  for (i = 0; i < 900; i++) {
    ctx.fillStyle = 'rgba(120,102,80,' + (0.02 + rnd() * 0.05).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1);
  }

  /* 包边 */
  ctx.strokeStyle = 'rgba(118,100,78,0.5)';
  ctx.lineWidth = Math.max(3, w * 0.035);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
}

/* 镜面：不是真反射，而是一张“反射了暖灯与房间”的低成本贴图 */
function paintMirror(ctx, w, h) {
  var rnd = seeded(0x77c1a3);
  var i;
  var g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f8efe2');
  g.addColorStop(0.32, '#e6dccd');
  g.addColorStop(0.66, '#c9bfaf');
  g.addColorStop(1, '#a99f91');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* 顶部暖灯的光斑 */
  var bloom = ctx.createRadialGradient(w * 0.5, h * 0.2, 0, w * 0.5, h * 0.2, w * 0.42);
  bloom.addColorStop(0, 'rgba(255,246,228,0.95)');
  bloom.addColorStop(0.45, 'rgba(255,240,214,0.35)');
  bloom.addColorStop(1, 'rgba(255,240,214,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);

  /* 对面墙与台面的模糊投影 */
  ctx.fillStyle = 'rgba(160,146,128,0.18)';
  ctx.fillRect(0, h * 0.58, w, h * 0.16);
  ctx.fillStyle = 'rgba(120,106,90,0.14)';
  ctx.fillRect(0, h * 0.76, w, h * 0.24);

  /* 左右边缘的暗角 */
  var side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(60,50,40,0.30)');
  side.addColorStop(0.08, 'rgba(60,50,40,0)');
  side.addColorStop(0.92, 'rgba(60,50,40,0)');
  side.addColorStop(1, 'rgba(60,50,40,0.30)');
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w, h);

  for (i = 0; i < 220; i++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + rnd() * 0.05).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
}

/* 磨砂窗：暖色漫射玻璃，斜向光带与柔光斑 */
function paintWindow(ctx, w, h) {
  var rnd = seeded(0x5ad0f1);
  var i;
  var g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#f7dcb4');
  g.addColorStop(0.55, '#ffe6c1');
  g.addColorStop(1, '#fff3dd');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* 斜向日光带 */
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.6);
  for (i = -2; i <= 2; i++) {
    ctx.fillStyle = 'rgba(255,252,242,' + (0.10 + rnd() * 0.10).toFixed(3) + ')';
    ctx.fillRect(i * w * 0.28 - w * 0.05, -h, w * 0.11, h * 2);
  }
  ctx.restore();

  /* 磨砂颗粒感 */
  for (i = 0; i < 28; i++) {
    var cx = rnd() * w;
    var cy = rnd() * h;
    var r = w * (0.06 + rnd() * 0.16);
    var dot = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    dot.addColorStop(0, 'rgba(255,255,250,0.30)');
    dot.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.fillStyle = dot;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  /* 玻璃后隐约的树影 */
  for (i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(150,150,110,0.10)';
    ctx.fillRect(rnd() * w, h * 0.45 + rnd() * h * 0.4, w * (0.1 + rnd() * 0.2), h * 0.1);
  }
}

/* 接地阴影贴片：一张柔和径向渐变，合并成一个透明批次 */
function paintShadow(ctx, w, h) {
  var grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.66)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.30)');
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
  var eyeHeight = isNum(opts.eyeHeight) ? opts.eyeHeight : 1.6;
  var high = quality === 'high';
  var ringSeg = high ? 20 : 12;
  var tubeSeg = high ? 18 : 10;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 5.5, 15);

  var world = new THREE.Group();
  world.name = 'bathroom';
  world.userData.eyeHeight = eyeHeight;
  world.userData.quality = quality;
  scene.add(world);

  /* ---------------- lights (2 或 3, 无阴影贴图) ---------------- */
  var hemi = new THREE.HemisphereLight(0xfff0dc, 0x53463b, 0.62);
  hemi.name = 'bathroom-hemi';
  world.add(hemi);

  var warmPoint = new THREE.PointLight(0xffd6a4, 2.2, 7, 2);
  warmPoint.name = 'bathroom-warm';
  warmPoint.position.set(0, 2.28, -0.45);
  world.add(warmPoint);

  if (high) {
    /* 磨砂窗透进来的日光，只在高画质点亮 */
    var windowLight = new THREE.PointLight(0xffeccb, 1.3, 4.2, 2);
    windowLight.name = 'bathroom-window';
    windowLight.position.set(-1.08, 1.7, -0.05);
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
  var stoneTex = high ? createCanvasTexture(THREE, 256, 256, paintStone, true) : null;
  var woodTex = high ? createCanvasTexture(THREE, 128, 128, paintWood, true) : null;
  var matTex = high ? createCanvasTexture(THREE, 128, 128, paintMat, false) : null;
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
      color: tileTex ? 0xffffff : 0xded2c0,
      map: tileTex,
      roughness: 0.38,
      metalness: 0.02
    })
    : new THREE.MeshLambertMaterial({ color: 0xdbcfbd });
  matTile.name = 'bathroom-wall-tile';

  var matStone = high
    ? new THREE.MeshStandardMaterial({
      color: stoneTex ? 0xffffff : 0xcac0b1,
      map: stoneTex,
      roughness: 0.68,
      metalness: 0.02
    })
    : new THREE.MeshLambertMaterial({ color: 0xc7bdae });
  matStone.name = 'bathroom-stone';

  /* 天花朝下，主光吃不均匀，用不受光材质保持干净 */
  var matCeiling = new THREE.MeshBasicMaterial({ color: 0xe4d9cb });
  matCeiling.name = 'bathroom-ceiling';

  var matWood = high
    ? new THREE.MeshStandardMaterial({
      color: woodTex ? 0xffffff : 0x9d6d47,
      map: woodTex,
      roughness: 0.56,
      metalness: 0.0
    })
    : new THREE.MeshLambertMaterial({ color: 0x9d6d47 });
  matWood.name = 'bathroom-wood';

  var matCeramic = new THREE.MeshStandardMaterial({
    color: 0xf7f4ee, roughness: 0.14, metalness: 0.02
  });
  matCeramic.name = 'bathroom-ceramic';

  var matMetal = new THREE.MeshStandardMaterial({
    color: 0xc9c5bd, roughness: 0.26, metalness: 0.88
  });
  matMetal.name = 'bathroom-metal';

  var matMirror = new THREE.MeshBasicMaterial({
    color: mirrorTex ? 0xffffff : 0xcfd3cd,
    map: mirrorTex
  });
  matMirror.name = 'bathroom-mirror';

  var matWater = new THREE.MeshStandardMaterial({
    color: 0x9fb9ba,
    roughness: 0.06,
    metalness: 0.05,
    transparent: true,
    opacity: 0.74,
    depthWrite: false
  });
  matWater.name = 'bathroom-water';

  var matLinen = new THREE.MeshStandardMaterial({
    color: 0xf1e9dc, roughness: 0.95, metalness: 0.0
  });
  matLinen.name = 'bathroom-linen';

  var matBathMat = high
    ? new THREE.MeshStandardMaterial({
      color: matTex ? 0xffffff : 0xd3c4ad,
      map: matTex,
      roughness: 0.94,
      metalness: 0.0
    })
    : new THREE.MeshLambertMaterial({ color: 0xd0c1aa });
  matBathMat.name = 'bathroom-slip-mat';

  var matPot = new THREE.MeshStandardMaterial({
    color: 0xb98a6c, roughness: 0.86, metalness: 0.0
  });
  matPot.name = 'bathroom-pot';

  var matLeaves = new THREE.MeshStandardMaterial({
    color: 0x557a4d,
    roughness: 0.78,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
  matLeaves.name = 'bathroom-plant';

  var matGlow = new THREE.MeshBasicMaterial({ color: 0xffe7c6 });
  matGlow.name = 'bathroom-glow';

  var matWindow = new THREE.MeshBasicMaterial({
    color: windowTex ? 0xffffff : 0xffe8c8,
    map: windowTex
  });
  matWindow.name = 'bathroom-window';

  var matShadow = null;
  if (shadowTex) {
    matShadow = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: shadowTex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });
    matShadow.name = 'bathroom-contact-shadow';
  }

  /* ---------------- shell: floor, tiled walls, ceiling ---------------- */
  var floorBatch = new Batch(THREE);
  floorBatch.plane(ROOM_W, ROOM_D, 0, 0, 0, -Math.PI / 2, 0, ROOM_W, ROOM_D);
  var floorMesh = floorBatch.build(matStone, 'bathroom-floor');
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

  /* ============ 洗手台（后墙左半） ============ */
  wood.box(1.12, 0.64, 0.46, VANITY_X, 0.46, VANITY_Z);              /* 柜体 */
  wood.box(1.0, 0.14, 0.36, VANITY_X, 0.07, VANITY_Z - 0.04);        /* 内收踢脚 */
  wood.box(0.54, 0.28, 0.02, VANITY_X - 0.28, 0.65, VANITY_Z + 0.23); /* 上抽屉面 */
  wood.box(0.54, 0.28, 0.02, VANITY_X + 0.28, 0.65, VANITY_Z + 0.23);
  wood.box(0.54, 0.26, 0.02, VANITY_X - 0.28, 0.33, VANITY_Z + 0.23); /* 下柜门 */
  wood.box(0.54, 0.26, 0.02, VANITY_X + 0.28, 0.33, VANITY_Z + 0.23);
  metal.box(0.16, 0.012, 0.02, VANITY_X - 0.28, 0.7, VANITY_Z + 0.245);
  metal.box(0.16, 0.012, 0.02, VANITY_X + 0.28, 0.7, VANITY_Z + 0.245);
  metal.box(0.014, 0.1, 0.02, VANITY_X - 0.55, 0.4, VANITY_Z + 0.245);
  metal.box(0.014, 0.1, 0.02, VANITY_X + 0.55, 0.4, VANITY_Z + 0.245);

  /* 石材台面 + 后挡水 */
  var counter = new Batch(THREE);
  counter.box(1.18, 0.045, 0.5, VANITY_X, COUNTER_H - 0.0225, VANITY_Z);
  counter.box(1.18, 0.1, 0.02, VANITY_X, COUNTER_H + 0.05, -ROOM_D / 2 + 0.011);
  var counterMesh = counter.build(matStone, 'bathroom-counter');
  if (counterMesh) { world.add(counterMesh); }

  /* 陶瓷台上盆 + 龙头 */
  ceramic.cylinder(0.21, 0.152, 0.13, ringSeg, VANITY_X, COUNTER_H + 0.065, VANITY_Z + 0.04);
  var basinRim = new THREE.TorusGeometry(0.204, 0.011, 6, ringSeg);
  ceramic.add(basinRim, VANITY_X, COUNTER_H + 0.128, VANITY_Z + 0.04, Math.PI / 2, 0, 0, 1, 1);
  metal.cylinder(0.018, 0.018, 0.24, ringSeg, VANITY_X, COUNTER_H + 0.25, VANITY_Z - 0.19);
  metal.add(
    new THREE.CylinderGeometry(0.014, 0.014, 0.13, 12),
    VANITY_X, COUNTER_H + 0.365, VANITY_Z - 0.125, Math.PI / 2, 0, 0, 1, 1
  );
  metal.cylinder(0.012, 0.012, 0.03, 10, VANITY_X, COUNTER_H + 0.35, VANITY_Z - 0.062);
  metal.box(0.09, 0.016, 0.02, VANITY_X + 0.05, COUNTER_H + 0.37, VANITY_Z - 0.19);

  /* 镜框（木）+ 镜面 */
  wood.box(0.98, 0.035, 0.035, VANITY_X, 2.035, -1.482);
  wood.box(0.98, 0.035, 0.035, VANITY_X, 1.005, -1.482);
  wood.box(0.035, 1.0, 0.035, VANITY_X - 0.47, 1.52, -1.482);
  wood.box(0.035, 1.0, 0.035, VANITY_X + 0.47, 1.52, -1.482);

  var mirrorMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.96), matMirror);
  mirrorMesh.name = 'bathroom-mirror';
  mirrorMesh.position.set(VANITY_X, 1.52, -1.487);
  mirrorMesh.userData.selectable = true;
  mirrorMesh.userData.targetId = 1;
  mirrorMesh.userData.label = 'mirror';
  world.add(mirrorMesh);

  /* 镜前暖光条 */
  glow.box(0.5, 0.055, 0.018, VANITY_X, 2.075, -1.478);

  /* ============ 马桶（后墙右半，面朝 +z） ============ */
  ceramic.box(0.4, 0.42, 0.2, WC_X, 0.77, -1.39);                   /* 水箱 */
  ceramic.box(0.43, 0.045, 0.22, WC_X, 1.0025, -1.39);              /* 水箱盖 */
  ceramic.box(0.28, 0.16, 0.36, WC_X, 0.08, WC_Z - 0.01);           /* 底座 */

  var bowl = new THREE.CylinderGeometry(0.185, 0.13, 0.3, tubeSeg);
  bowl.scale(1, 1, 1.25);
  ceramic.add(bowl, WC_X, 0.3, WC_Z, 0, 0, 0, 1, 1);

  var bowlRim = new THREE.TorusGeometry(0.172, 0.028, 6, tubeSeg);
  bowlRim.scale(1, 1.25, 1);
  ceramic.add(bowlRim, WC_X, 0.455, WC_Z, Math.PI / 2, 0, 0, 1, 1);

  var seat = new THREE.TorusGeometry(0.168, 0.036, 6, tubeSeg);
  seat.scale(1, 1.25, 1);
  ceramic.add(seat, WC_X, 0.487, WC_Z, Math.PI / 2, 0, 0, 1, 1);

  /* 立起的盖板，靠在木箱前壁；内水面因此可见 */
  var lid = new THREE.CylinderGeometry(0.176, 0.176, 0.02, tubeSeg);
  lid.scale(1, 1, 1.25);
  ceramic.add(lid, WC_X, 0.75, -1.27, -1.4, 0, 0, 1, 1);

  metal.box(0.05, 0.03, 0.04, WC_X - 0.11, 0.5, -1.29);
  metal.box(0.05, 0.03, 0.04, WC_X + 0.11, 0.5, -1.29);

  /* 双按键冲水 */
  metal.cylinder(0.032, 0.032, 0.012, 14, WC_X - 0.05, 1.031, -1.39);
  metal.cylinder(0.024, 0.024, 0.012, 12, WC_X + 0.06, 1.031, -1.39);

  /* 内水面：单独一层，可做极轻的浮动 */
  var waterGeo = new THREE.CylinderGeometry(0.118, 0.118, 0.004, tubeSeg);
  waterGeo.scale(1, 1, 1.25);
  var waterMesh = new THREE.Mesh(waterGeo, matWater);
  waterMesh.name = 'bathroom-water';
  waterMesh.position.set(WC_X, WATER_Y, WC_Z);
  world.add(waterMesh);

  /* ============ 无障碍扶手（右墙，木质抓握面） ============ */
  metal.box(0.055, 0.03, 0.03, 1.38, 0.95, -1.16);
  metal.box(0.055, 0.03, 0.03, 1.38, 0.95, -0.48);

  var railMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.72), matWood);
  railMesh.name = 'bathroom-grab-bar';
  railMesh.position.set(1.355, 0.95, -0.82);
  railMesh.userData.selectable = true;
  railMesh.userData.targetId = 3;
  railMesh.userData.label = 'grab-bar';
  world.add(railMesh);

  /* ============ 防滑垫（洗手台前） ============ */
  var bathMatMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.55), matBathMat);
  bathMatMesh.name = 'bathroom-slip-mat';
  bathMatMesh.position.set(-0.7, 0.006, -0.6);
  bathMatMesh.rotation.x = -Math.PI / 2;
  world.add(bathMatMesh);

  /* ============ 毛巾（左前墙挂杆，淋浴区之外） ============ */
  metal.add(
    new THREE.CylinderGeometry(0.012, 0.012, 0.62, 10),
    -1.37, 1.3, 0.95, Math.PI / 2, 0, 0, 1, 1
  );
  metal.box(0.04, 0.03, 0.03, -1.39, 1.3, 0.66);
  metal.box(0.04, 0.03, 0.03, -1.39, 1.3, 1.24);

  linen.box(0.05, 0.045, 0.44, -1.36, 1.283, 0.95);
  linen.box(0.032, 0.56, 0.42, -1.362, 1.0, 0.95);

  if (high) {
    /* 台面上叠好的手巾 */
    linen.box(0.26, 0.05, 0.2, VANITY_X - 0.4, COUNTER_H + 0.025, VANITY_Z + 0.03);
    linen.box(0.22, 0.04, 0.17, VANITY_X - 0.4, COUNTER_H + 0.07, VANITY_Z + 0.03);
  }

  /* ============ 置物架 + 小植物（右后墙） ============ */
  wood.box(0.7, 0.04, 0.2, 0.8, 1.62, -1.38);
  metal.box(0.05, 0.12, 0.03, 0.52, 1.55, -1.46);
  metal.box(0.05, 0.12, 0.03, 1.08, 1.55, -1.46);

  var pot = new Batch(THREE);
  pot.cylinder(0.078, 0.058, 0.12, 16, 0.95, 1.7, -1.36);
  pot.cylinder(0.083, 0.08, 0.022, 16, 0.95, 1.766, -1.36);
  var potMesh = pot.build(matPot, 'bathroom-pot');
  if (potMesh) { world.add(potMesh); }

  /* 叶片：整株合成一张网格，可整体轻摆 */
  var plant = new Batch(THREE);
  var leafRnd = seeded(0x7ab1e5);
  var li;
  for (li = 0; li < 8; li++) {
    /* 叶片只朝房间一侧展开：既像植物朝光生长，也不会插进背后墙面 */
    var ang = Math.PI / 2 + (li - 3.5) * 0.34 + leafRnd() * 0.12;
    var stemIn = 0.012 + leafRnd() * 0.018;
    var reach = 0.06 + leafRnd() * 0.05;
    plant.cylinder(
      0.0045, 0.005, 0.12 + leafRnd() * 0.05, 5,
      Math.cos(ang) * stemIn, 0.065, Math.sin(ang) * stemIn
    );
    plant.plane(
      0.07, 0.14,
      Math.cos(ang) * reach, 0.175 + leafRnd() * 0.05, Math.sin(ang) * reach,
      -0.95 - leafRnd() * 0.35, ang,
      1, 1
    );
  }
  var leavesMesh = plant.build(matLeaves, 'bathroom-plant-leaves');
  leavesMesh.position.set(0.95, 1.775, -1.36);
  /* 这一株要轻摆，必须恢复矩阵自更新（合批网格默认是静态的） */
  leavesMesh.matrixAutoUpdate = true;
  leavesMesh.updateMatrix();
  leavesMesh.userData.selectable = true;
  leavesMesh.userData.targetId = 2;
  leavesMesh.userData.label = 'plant';
  world.add(leavesMesh);

  if (high) {
    /* 两个陶瓷小瓶 + 金属盖 */
    ceramic.cylinder(0.032, 0.036, 0.16, 12, 0.55, 1.72, -1.36);
    ceramic.cylinder(0.026, 0.03, 0.12, 12, 0.66, 1.7, -1.38);
    metal.cylinder(0.017, 0.017, 0.022, 10, 0.55, 1.81, -1.36);
    metal.cylinder(0.014, 0.014, 0.018, 10, 0.66, 1.768, -1.38);
  }

  /* ============ 磨砂窗（左墙） ============ */
  var windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.05), matWindow);
  windowMesh.name = 'bathroom-frosted-window';
  windowMesh.position.set(-ROOM_W / 2 + 0.006, 1.6, -0.05);
  windowMesh.rotation.y = Math.PI / 2;
  world.add(windowMesh);

  wood.box(0.035, 0.05, 1.05, -ROOM_W / 2 + 0.018, 2.15, -0.05);
  wood.box(0.035, 0.05, 1.05, -ROOM_W / 2 + 0.018, 1.05, -0.05);
  wood.box(0.035, 1.15, 0.05, -ROOM_W / 2 + 0.018, 1.6, 0.5);
  wood.box(0.035, 1.15, 0.05, -ROOM_W / 2 + 0.018, 1.6, -0.6);
  wood.box(0.09, 0.03, 1.15, -ROOM_W / 2 + 0.045, 1.03, -0.05);

  /* ============ 淋浴区（前右）：玻璃隔断 + 花洒 ============ */
  /* 低画质省掉整块透明玻璃与顶轨：花洒与地漏仍在，透明面是 Adreno 上最贵的填充 */
  if (high) {
    /* 玻璃：透明但不用 transmission（Adreno 540 上代价太高） */
    var matGlass = new THREE.MeshStandardMaterial({
      color: 0xdff0ef,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    matGlass.name = 'bathroom-glass';

    var glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 2.0), matGlass);
    glassMesh.name = 'bathroom-shower-glass';
    glassMesh.position.set(0.58, 1.0, 0.62);
    glassMesh.rotation.y = Math.PI / 2;
    glassMesh.renderOrder = 2;
    world.add(glassMesh);

    metal.add(
      new THREE.CylinderGeometry(0.013, 0.013, 0.74, 10),
      0.58, 2.0, 0.62, Math.PI / 2, 0, 0, 1, 1
    );
  }

  metal.add(
    new THREE.CylinderGeometry(0.012, 0.012, 0.26, 10),
    1.28, 2.05, 0.8, 0, 0, Math.PI / 2, 1, 1
  );
  metal.cylinder(0.092, 0.092, 0.014, ringSeg, 1.15, 2.035, 0.8);
  metal.box(0.03, 0.1, 0.16, 1.385, 1.15, 0.8);
  metal.add(
    new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12),
    1.36, 1.15, 0.8, 0, 0, Math.PI / 2, 1, 1
  );
  metal.cylinder(0.05, 0.05, 0.006, 14, 1.05, 0.004, 0.95);

  /* ============ 顶灯（暖光盘） ============ */
  metal.cylinder(0.19, 0.19, 0.016, ringSeg, 0, ROOM_H - 0.008, -0.25);
  glow.cylinder(0.168, 0.168, 0.012, ringSeg, 0, ROOM_H - 0.02, -0.25);

  /* ---------------- 接地阴影：单批次透明贴片 ---------------- */
  if (shadowTex) {
    var shadows = new Batch(THREE);
    shadows.plane(1.4, 0.85, VANITY_X, 0.004, VANITY_Z + 0.02, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.72, 0.8, WC_X, 0.004, WC_Z, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.6, 0.9, 0.95, 0.004, 1.0, -Math.PI / 2, 0, 1, 1);
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

  /* ---------------- 交互目标 ---------------- */
  var selectables = [mirrorMesh, leavesMesh, railMesh];

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

  var textureList = [tileTex, stoneTex, woodTex, matTex, mirrorTex, windowTex, shadowTex];
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
    leavesMesh.rotation.z = Math.sin(clock * 0.85) * 0.028;
    leavesMesh.rotation.x = Math.sin(clock * 0.53 + 1.1) * 0.016;
    waterMesh.position.y = WATER_Y + Math.sin(clock * 1.25) * 0.0012;
    matWater.opacity = 0.74 + Math.sin(clock * 0.9) * 0.04;
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
