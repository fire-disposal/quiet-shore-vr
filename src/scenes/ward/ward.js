/*!
 * WardScene 2.0.0
 * Procedural training-ward scene for Three.js r152 (PICO G2 4K / Adreno 540).
 *
 * ES module (ES5 syntax inside). Exports createWorld and VERSION; no globals.
 *
 * Contract:
 *   var built = createWorld(THREE, { quality: 'high', eyeHeight: 1.6 });
 *   built.scene        THREE.Scene
 *   built.world        THREE.Group containing every mesh and light (floor at local y = 0)
 *   built.update(dt)   cheap animation tick, seconds
 *   built.selectables  array of 3 Meshes with userData.selectable === true
 *   built.dispose()    releases geometries, materials and generated textures
 *
 * The room is authored at real-world scale so WebXR `local` space can be fixed with
 *   world.position.y = -world.userData.eyeHeight;
 * while a 2D preview keeps world.position.y = 0.
 *
 * Rendering budget (high tier): one mesh per material, canvas textures only,
 * no shadow maps, no postprocessing, no per-frame allocation in update().
 * Animation is texture-offset scrolling (ECG trace) plus a screen brightness
 * pulse and a clock second hand rotation.
 */
var VERSION = '2.0.0';
var BG_COLOR = 0x080c11;
var FOG_COLOR = 0x0e161d;

/* 房间尺寸（米） */
var ROOM_W = 4.6;   /* x */
var ROOM_D = 5.2;   /* z */
var ROOM_H = 2.7;   /* y */

/* 病床与主要道具的位置（米），所有细节都从这里派生 */
var BED_X = -0.9;
var BED_HEAD = -1.76;
var BED_FOOT = 0.28;
var BED_W = 1.02;
var BED_CZ = (BED_HEAD + BED_FOOT) / 2;
var BED_LEN = BED_FOOT - BED_HEAD;

var WIN_Z = 0.55;
var WIN_W = 1.6;
var WIN_Y = 1.5;
var WIN_H = 0.9;

var CAB_X = 0.12;
var CAB_Z = -1.95;
var CAB_TOP = 0.64;

var MON_X = 1.05;
var MON_Z = -2.05;
var MON_Y = 1.30;

var IV_X = -1.85;
var IV_Z = -1.05;

var CHAIR_X = 1.3;
var CHAIR_Z = 0.52;

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
  /* 程序化贴图全部是 sRGB 色彩空间绘制出来的，必须显式声明 */
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (repeat === 'x') {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  } else if (repeat) {
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

/* 医用塑胶地板：一张 256² 纹理代表 1.2 m（2×2 块 600 mm 卷材） */
function paintFloor(ctx, w, h) {
  var rnd = seeded(0x51f3a7);
  var i, x, y, tone, grad;
  ctx.fillStyle = '#b6c0c5';
  ctx.fillRect(0, 0, w, h);
  for (y = 0; y < 2; y++) {
    for (x = 0; x < 2; x++) {
      tone = 182 + Math.floor(rnd() * 12);
      ctx.fillStyle = 'rgb(' + tone + ',' + (tone + 6) + ',' + (tone + 9) + ')';
      ctx.fillRect(x * 128 + 1.5, y * 128 + 1.5, 125, 125);
    }
  }
  /* 焊缝：亮边 + 暗线，近看有塑胶卷材的层次 */
  ctx.strokeStyle = 'rgba(104,118,126,0.5)';
  ctx.lineWidth = 2;
  for (i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 128, 0);
    ctx.lineTo(i * 128, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * 128);
    ctx.lineTo(w, i * 128);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(236,242,244,0.55)';
  ctx.lineWidth = 1;
  for (i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 128 + 1.5, 0);
    ctx.lineTo(i * 128 + 1.5, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * 128 + 1.5);
    ctx.lineTo(w, i * 128 + 1.5);
    ctx.stroke();
  }
  /* 细颗粒 */
  for (i = 0; i < 2200; i++) {
    ctx.fillStyle = 'rgba(108,122,130,' + (0.03 + rnd() * 0.08).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  /* 两个方向各一道柔和高光，模拟塑胶地板的半哑反光 */
  grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/* 墙面：浅灰绿乳胶漆，1.2 m 板缝 + 底部轻微擦痕 */
function paintWall(ctx, w, h) {
  var rnd = seeded(0x2b71c1);
  var i, grad, grime;
  grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#eef3ef');
  grad.addColorStop(0.55, '#e4eae5');
  grad.addColorStop(1, '#d7ded9');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(146,156,152,0.22)';
  ctx.fillRect(0, 0, 2, h);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(2, 0, 2, h);

  for (i = 0; i < 520; i++) {
    ctx.fillStyle = 'rgba(118,130,126,' + (0.02 + rnd() * 0.05).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
  }
  grime = ctx.createLinearGradient(0, h * 0.8, 0, h);
  grime.addColorStop(0, 'rgba(122,132,127,0)');
  grime.addColorStop(1, 'rgba(122,132,127,0.14)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
}

/* 木纹：床头板/柜体用的浅色橡木贴面，256×128 */
function paintWood(ctx, w, h) {
  var rnd = seeded(0x7a1c0d);
  var i, y, x, amp, grad;
  grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#c6ab8c');
  grad.addColorStop(0.5, '#bda183');
  grad.addColorStop(1, '#b3987a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  for (i = 0; i < 90; i++) {
    y = rnd() * h;
    amp = 1 + rnd() * 3;
    ctx.strokeStyle = 'rgba(' + (120 + Math.floor(rnd() * 40)) + ',' +
      (94 + Math.floor(rnd() * 30)) + ',' + (70 + Math.floor(rnd() * 24)) + ',' +
      (0.06 + rnd() * 0.16).toFixed(3) + ')';
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath();
    for (x = 0; x <= w; x += 8) {
      var py = y + Math.sin((x / w) * Math.PI * 2 + i) * amp;
      if (x === 0) {
        ctx.moveTo(x, py);
      } else {
        ctx.lineTo(x, py);
      }
    }
    ctx.stroke();
  }
  /* 两处木节，打破规则感 */
  for (i = 0; i < 2; i++) {
    var cx = 40 + rnd() * (w - 80);
    var cy = 20 + rnd() * (h - 40);
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9 + rnd() * 5);
    grad.addColorStop(0, 'rgba(122,94,68,0.32)');
    grad.addColorStop(1, 'rgba(122,94,68,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* 织物：平纹布，白色基底，材质 color 负责色相 */
function paintFabric(ctx, w, h) {
  var rnd = seeded(0x3f9d2b);
  var i, grad;
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, w, h);
  for (i = 0; i < w; i += 2) {
    ctx.fillStyle = 'rgba(120,124,118,0.07)';
    ctx.fillRect(i, 0, 1, h);
  }
  for (i = 0; i < h; i += 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, i, w, 1);
  }
  for (i = 0; i < 24; i++) {
    grad = ctx.createRadialGradient(
      rnd() * w, rnd() * h, 0,
      rnd() * w, rnd() * h, 10 + rnd() * 22
    );
    grad.addColorStop(0, 'rgba(178,180,172,0.09)');
    grad.addColorStop(1, 'rgba(178,180,172,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

/* 车床织物/床品的细微褶皱（法线感靠颜色明暗模拟，无额外贴图） */
function paintShadow(ctx, w, h) {
  var grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.7)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.36)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/* 窗外日光：柔和的天空渐变，略偏冷的顶部与偏暖的地面反光 */
function paintSky(ctx, w, h) {
  var grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#c9e0f2');
  grad.addColorStop(0.45, '#e6f1f8');
  grad.addColorStop(0.72, '#f6f5ee');
  grad.addColorStop(1, '#dfe3d7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  var haze = ctx.createRadialGradient(w * 0.62, h * 0.32, 0, w * 0.62, h * 0.32, w * 0.6);
  haze.addColorStop(0, 'rgba(255,255,255,0.85)');
  haze.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, h);

  /* 远处树影：只留一层很淡的绿灰 */
  ctx.fillStyle = 'rgba(120,138,116,0.16)';
  ctx.beginPath();
  ctx.ellipse(w * 0.24, h * 0.86, w * 0.3, h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(w * 0.78, h * 0.9, w * 0.26, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* 监护仪屏幕底版：网格 + 数值，波形区域留给滚动的 ECG 贴图 */
function paintScreen(ctx, w, h) {
  var x, y;
  ctx.fillStyle = '#061014';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(40,120,110,0.26)';
  ctx.lineWidth = 1;
  for (x = 0; x <= w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (y = 0; y <= h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  /* 顶栏：心率、血氧、血压 */
  ctx.fillStyle = 'rgba(12,26,28,0.85)';
  ctx.fillRect(0, 0, w, 34);

  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = '#8af3c5';
  ctx.fillText('HR', 8, 14);
  ctx.font = 'bold 22px monospace';
  ctx.fillText('72', 8, 32);

  ctx.font = 'bold 10px monospace';
  ctx.fillStyle = '#7fdcff';
  ctx.fillText('SpO2', 92, 14);
  ctx.font = 'bold 17px monospace';
  ctx.fillText('98', 92, 32);

  ctx.font = 'bold 10px monospace';
  ctx.fillStyle = '#ffd88a';
  ctx.fillText('NIBP', 150, 14);
  ctx.font = 'bold 14px monospace';
  ctx.fillText('118/76', 150, 31);

  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(150,235,205,0.6)';
  ctx.fillText('LEAD II', 8, 48);
  ctx.fillStyle = 'rgba(200,225,235,0.45)';
  ctx.fillText('25 mm/s', 190, 48);

  /* 波形区域的基线格 */
  ctx.strokeStyle = 'rgba(60,150,130,0.16)';
  ctx.beginPath();
  ctx.moveTo(6, 84);
  ctx.lineTo(w - 6, 84);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(90,240,190,0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

/* ECG 波形条：横向可无缝平铺（两张完整的复合波），动画只滚动 offset.x */
function paintEcg(ctx, w, h) {
  var x, p, v, y, label;
  ctx.clearRect(0, 0, w, h);

  function bump(phase, center, width) {
    var d = (phase - center) / width;
    return Math.exp(-d * d);
  }
  function shape(phase) {
    var out = 0;
    out += 0.055 * bump(phase, 0.14, 0.030);   /* P */
    out -= 0.115 * bump(phase, 0.262, 0.009);
    out += 0.95 * bump(phase, 0.292, 0.010);   /* R */
    out -= 0.24 * bump(phase, 0.325, 0.011);   /* S */
    out += 0.17 * bump(phase, 0.52, 0.052);    /* T */
    return out;
  }

  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#62f0b6';
  ctx.shadowColor = 'rgba(70,240,180,0.75)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  for (x = 0; x <= w; x++) {
    p = ((x / w) * 2) % 1;
    v = shape(p);
    y = h * 0.62 - v * h * 0.5;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  /* 心率标记 */
  label = Math.round(w * 0.86);
  ctx.fillStyle = 'rgba(110,255,200,0.55)';
  ctx.font = 'bold 9px monospace';
  ctx.fillText('72 bpm', label, 12);
}

/* ------------------------------------------------------------------ *
 * Static geometry batching: one mesh per material.
 * ------------------------------------------------------------------ */

function Batch(THREE) {
  this.THREE = THREE;
  this.parts = [];
}

Batch.prototype._push = function (geo, m, su, sv) {
  this.parts.push({
    geo: geo,
    m: m,
    su: isNum(su) ? su : 1,
    sv: isNum(sv) ? sv : 1
  });
  return this;
};

Batch.prototype.add = function (geo, x, y, z, rx, ry, rz, su, sv) {
  var m = new this.THREE.Matrix4();
  m.makeRotationFromEuler(new this.THREE.Euler(rx || 0, ry || 0, rz || 0));
  m.setPosition(x, y, z);
  return this._push(geo, m, su, sv);
};

/* 带缩放的放置：枕头、坐垫这类需要“捏”出柔软体量的几何体 */
Batch.prototype.addScaled = function (geo, x, y, z, rx, ry, rz, sx, sy, sz, su, sv) {
  var T = this.THREE;
  var m = new T.Matrix4();
  m.compose(
    new T.Vector3(x, y, z),
    new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)),
    new T.Vector3(sx, sy, sz)
  );
  return this._push(geo, m, su, sv);
};

Batch.prototype.box = function (w, h, d, x, y, z, su, sv) {
  return this.add(new this.THREE.BoxGeometry(w, h, d), x, y, z, 0, 0, 0, su, sv);
};

/* 带欧拉角的盒子：百叶片、斜靠的枕头、门板都靠它 */
Batch.prototype.boxR = function (w, h, d, x, y, z, rx, ry, rz, su, sv) {
  return this.add(new this.THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz, su, sv);
};

Batch.prototype.cyl = function (r, h, seg, x, y, z, rx, ry, rz) {
  return this.add(new this.THREE.CylinderGeometry(r, r, h, seg || 10), x, y, z, rx, ry, rz);
};

/* 锥形圆柱：输液杆的伸缩段、饮水杯 */
Batch.prototype.cylT = function (rTop, rBottom, h, seg, x, y, z, rx, ry, rz) {
  return this.add(
    new this.THREE.CylinderGeometry(rTop, rBottom, h, seg || 12),
    x, y, z, rx, ry, rz
  );
};

/* 单位球按半径捏成椭球：枕头、坐垫、输液袋 */
Batch.prototype.sphere = function (sx, sy, sz, x, y, z, wSeg, hSeg, rx, ry, rz) {
  return this.addScaled(
    new this.THREE.SphereGeometry(1, wSeg || 12, hSeg || 8),
    x, y, z, rx || 0, ry || 0, rz || 0, sx, sy, sz, 1, 1
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
    throw new Error('WardScene.createWorld: THREE is required');
  }
  opts = opts || {};
  var quality = opts.quality === 'low' ? 'low' : 'high';
  var eyeHeight = isNum(opts.eyeHeight) ? opts.eyeHeight : 1.7;
  var high = quality === 'high';

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 8, 20);

  var world = new THREE.Group();
  world.name = 'ward';
  world.userData.eyeHeight = eyeHeight;
  world.userData.quality = quality;
  scene.add(world);

  /* ---------------- lights (3, no shadows) ---------------- *
   * 冷日光从窗侧打进来，暖补光从门口方向托底，天光负责整体环境，
   * 强度都很低，避免病房出现硬边和过曝。 */
  var hemi = new THREE.HemisphereLight(0xe6f0fb, 0x4a535b, 0.62);
  hemi.name = 'ward-hemi';
  world.add(hemi);

  var sun = new THREE.DirectionalLight(0xf5f9ff, 1.02);
  sun.name = 'ward-daylight';
  sun.position.set(-3.1, 2.35, 1.15);
  world.add(sun);

  var fill = new THREE.DirectionalLight(0xfff0dd, 0.32);
  fill.name = 'ward-fill';
  fill.position.set(1.9, 2.6, 2.4);
  world.add(fill);

  /* ---------------- textures ---------------- */
  var floorTex = high ? createCanvasTexture(THREE, 256, 256, paintFloor, true) : null;
  var wallTex = high ? createCanvasTexture(THREE, 128, 128, paintWall, true) : null;
  var woodTex = high ? createCanvasTexture(THREE, 256, 128, paintWood, true) : null;
  var fabricTex = high ? createCanvasTexture(THREE, 256, 256, paintFabric, true) : null;
  /* 织物贴图按盒面 0..1 铺，直接给 4 次重复，纹理密度才像布而不是灯芯绒 */
  if (fabricTex) {
    fabricTex.repeat.set(4, 4);
  }
  var skyTex = high ? createCanvasTexture(THREE, 64, 64, paintSky, false) : null;
  var screenTex = createCanvasTexture(THREE, 256, 128, paintScreen, false);
  var ecgTex = createCanvasTexture(THREE, 256, 64, paintEcg, 'x');
  var shadowTex = createCanvasTexture(THREE, 128, 128, paintShadow, false);

  /* ---------------- materials ---------------- */
  var matFloor;
  if (high) {
    matFloor = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: floorTex, roughness: 0.44, metalness: 0.04
    });
  } else {
    matFloor = new THREE.MeshLambertMaterial({ color: 0x9aa5aa });
  }
  matFloor.name = 'ward-floor';

  var matShell;
  if (high) {
    matShell = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: wallTex, roughness: 0.94, metalness: 0.0
    });
  } else {
    matShell = new THREE.MeshLambertMaterial({ color: 0xd8e0db });
  }
  matShell.name = 'ward-shell';

  var matWood = high && woodTex
    ? new THREE.MeshStandardMaterial({
      color: 0xffffff, map: woodTex, roughness: 0.58, metalness: 0.02
    })
    : new THREE.MeshStandardMaterial({
      color: 0xc3a889, roughness: 0.62, metalness: 0.02
    });
  matWood.name = 'ward-wood';

  /* 金属降低 metalness：没有环境贴图时高金属度在移动端会发黑 */
  var matMetal = new THREE.MeshStandardMaterial({
    color: 0xc0c9d1, roughness: 0.38, metalness: 0.42
  });
  matMetal.name = 'ward-metal';

  var matPlastic = new THREE.MeshStandardMaterial({
    color: 0xeef1f2, roughness: 0.46, metalness: 0.03
  });
  matPlastic.name = 'ward-plastic';

  var matDark = new THREE.MeshStandardMaterial({
    color: 0x2b3238, roughness: 0.44, metalness: 0.16
  });
  matDark.name = 'ward-dark';

  var matLinen = high && fabricTex
    ? new THREE.MeshStandardMaterial({
      color: 0xf6f8f5, map: fabricTex, roughness: 0.97, metalness: 0.0
    })
    : new THREE.MeshStandardMaterial({
      color: 0xf1f4f1, roughness: 0.96, metalness: 0.0
    });
  matLinen.name = 'ward-linen';

  var matBlanket = high && fabricTex
    ? new THREE.MeshStandardMaterial({
      color: 0x6f9db4, map: fabricTex, roughness: 1.0, metalness: 0.0
    })
    : new THREE.MeshStandardMaterial({
      color: 0x6f9db4, roughness: 1.0, metalness: 0.0
    });
  matBlanket.name = 'ward-blanket';

  var matCurtain = high && fabricTex
    ? new THREE.MeshStandardMaterial({
      color: 0xd3d8cd, map: fabricTex, roughness: 0.98, metalness: 0.0
    })
    : new THREE.MeshStandardMaterial({
      color: 0xd3d8cd, roughness: 0.98, metalness: 0.0
    });
  matCurtain.name = 'ward-curtain';

  var screenMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: screenTex
  });
  if (!screenTex) {
    screenMat.color.setHex(0x1fe08a);
  }
  screenMat.name = 'ward-screen';

  var ecgMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: ecgTex,
    transparent: true,
    opacity: 1,
    depthWrite: false
  });
  ecgMat.name = 'ward-ecg';

  /* 不受光的高光件：灯盘、门玻璃、仪表刻度 */
  var glowMat = new THREE.MeshBasicMaterial({ color: 0xe8f4ff });
  glowMat.name = 'ward-glow';

  var dayMat = new THREE.MeshBasicMaterial({ color: 0xdcecf8, map: skyTex });
  dayMat.name = 'ward-daylight-pane';

  var ceilingMat = new THREE.MeshBasicMaterial({ color: 0xc6ced3 });
  ceilingMat.name = 'ward-ceiling';

  var shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: shadowTex,
    transparent: true,
    opacity: 0.8,
    depthWrite: false
  });
  shadowMat.name = 'ward-contact-shadow';

  /* ---------------- batches ---------------- */
  var wood = new Batch(THREE);
  var plastic = new Batch(THREE);
  var metal = new Batch(THREE);
  var dark = new Batch(THREE);
  var linen = new Batch(THREE);
  var blanket = new Batch(THREE);
  var curtain = new Batch(THREE);
  var glow = new Batch(THREE);

  /* ================= shell ================= */
  var floorBatch = new Batch(THREE);
  floorBatch.plane(
    ROOM_W, ROOM_D,
    0, 0, 0,
    -Math.PI / 2, 0,
    ROOM_W / 1.2, ROOM_D / 1.2
  );
  var floorMesh = floorBatch.build(matFloor, 'ward-floor-mesh');
  if (floorMesh) { world.add(floorMesh); }

  var shell = new Batch(THREE);
  var wallU = ROOM_W / 1.2;
  var wallV = 1;   /* 竖向只铺一次，避免渐变每 1.2 m 重复出现横带 */
  shell.plane(ROOM_W, ROOM_H, 0, ROOM_H / 2, -ROOM_D / 2, 0, 0, wallU, wallV);
  shell.plane(ROOM_D, ROOM_H, -ROOM_W / 2, ROOM_H / 2, 0, 0, Math.PI / 2, wallU, wallV);
  shell.plane(ROOM_D, ROOM_H, ROOM_W / 2, ROOM_H / 2, 0, 0, -Math.PI / 2, wallU, wallV);
  shell.plane(ROOM_W, ROOM_H, 0, ROOM_H / 2, ROOM_D / 2, 0, Math.PI, wallU, wallV);
  var shellMesh = shell.build(matShell, 'ward-shell-mesh');
  if (shellMesh) { world.add(shellMesh); }

  var ceilingBatch = new Batch(THREE);
  ceilingBatch.plane(ROOM_W, ROOM_D, 0, ROOM_H, 0, Math.PI / 2, 0, 1, 1);
  var ceilingMesh = ceilingBatch.build(ceilingMat, 'ward-ceiling-mesh');
  if (ceilingMesh) { world.add(ceilingMesh); }

  /* 踢脚线：两层叠出倒角 */
  plastic.box(ROOM_W, 0.085, 0.022, 0, 0.0425, -ROOM_D / 2 + 0.011);
  plastic.box(ROOM_W, 0.085, 0.022, 0, 0.0425, ROOM_D / 2 - 0.011);
  plastic.box(0.022, 0.085, ROOM_D, -ROOM_W / 2 + 0.011, 0.0425, 0);
  plastic.box(0.022, 0.085, ROOM_D, ROOM_W / 2 - 0.011, 0.0425, 0);
  plastic.box(ROOM_W, 0.016, 0.03, 0, 0.082, -ROOM_D / 2 + 0.015);
  plastic.box(0.03, 0.016, ROOM_D, -ROOM_W / 2 + 0.015, 0.082, 0);
  plastic.box(0.03, 0.016, ROOM_D, ROOM_W / 2 - 0.015, 0.082, 0);

  /* 防撞扶手：圆柱杆 + 上下托条，病房走廊常见 */
  plastic.cyl(0.028, ROOM_W - 0.1, 12, 0, 0.94, -ROOM_D / 2 + 0.075, 0, 0, Math.PI / 2);
  plastic.cyl(0.028, ROOM_D - 0.1, 12, -ROOM_W / 2 + 0.075, 0.94, 0, Math.PI / 2, 0, 0);
  plastic.cyl(0.028, ROOM_D - 0.1, 12, ROOM_W / 2 - 0.075, 0.94, 0, Math.PI / 2, 0, 0);
  metal.box(ROOM_W - 0.1, 0.03, 0.012, 0, 0.895, -ROOM_D / 2 + 0.018);
  metal.box(0.012, 0.03, ROOM_D - 0.1, -ROOM_W / 2 + 0.018, 0.895, 0);
  metal.box(0.012, 0.03, ROOM_D - 0.1, ROOM_W / 2 - 0.018, 0.895, 0);

  /* ================= window (left wall) ================= */
  var winX = -ROOM_W / 2;
  var dayMesh = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W, WIN_H), dayMat);
  dayMesh.name = 'ward-window-pane';
  dayMesh.position.set(winX + 0.008, WIN_Y, WIN_Z);
  dayMesh.rotation.y = Math.PI / 2;
  world.add(dayMesh);

  /* 窗框：外框 + 中挺 + 窗台，都是白色塑钢 */
  plastic.box(0.075, 0.07, WIN_W + 0.16, winX + 0.037, WIN_Y + WIN_H / 2 + 0.035, WIN_Z);
  plastic.box(0.075, 0.07, WIN_W + 0.16, winX + 0.037, WIN_Y - WIN_H / 2 - 0.035, WIN_Z);
  plastic.box(0.075, WIN_H + 0.14, 0.075, winX + 0.037, WIN_Y, WIN_Z - WIN_W / 2 - 0.0375);
  plastic.box(0.075, WIN_H + 0.14, 0.075, winX + 0.037, WIN_Y, WIN_Z + WIN_W / 2 + 0.0375);
  plastic.box(0.06, WIN_H, 0.05, winX + 0.045, WIN_Y, WIN_Z);
  plastic.box(0.06, 0.045, WIN_W, winX + 0.045, WIN_Y + 0.02, WIN_Z);
  /* 内窗台 */
  plastic.box(0.2, 0.035, WIN_W + 0.2, winX + 0.11, WIN_Y - WIN_H / 2 - 0.06, WIN_Z);

  if (high) {
    /* 百叶帘：16 片微倾斜叶片 + 上下轨 + 梯绳 */
    var slatY, slatI;
    var slatTop = WIN_Y + WIN_H / 2 - 0.03;
    plastic.box(0.08, 0.06, WIN_W + 0.04, winX + 0.1, slatTop + 0.025, WIN_Z);
    plastic.box(0.06, 0.022, WIN_W, winX + 0.095, WIN_Y - WIN_H / 2 + 0.015, WIN_Z);
    for (slatI = 0; slatI < 16; slatI++) {
      slatY = slatTop - slatI * 0.0475;
      plastic.boxR(0.058, 0.011, WIN_W - 0.02, winX + 0.1, slatY, WIN_Z, 0, 0, 0.52);
    }
    plastic.box(0.006, WIN_H - 0.12, 0.008, winX + 0.085, WIN_Y, WIN_Z - 0.52);
    plastic.box(0.006, WIN_H - 0.12, 0.008, winX + 0.085, WIN_Y, WIN_Z + 0.52);

    /* 窗帘杆 + 两侧布帘（竖向褶裥用圆柱堆出来） */
    metal.cyl(0.016, 2.0, 10, winX + 0.16, 2.06, WIN_Z, Math.PI / 2, 0, 0);
    metal.cyl(0.012, 0.05, 8, winX + 0.16, 2.06, WIN_Z - 1.02, Math.PI / 2, 0, 0);
    metal.cyl(0.012, 0.05, 8, winX + 0.16, 2.06, WIN_Z + 1.02, Math.PI / 2, 0, 0);
    var foldI, foldZ, panelZ;
    for (foldI = 0; foldI < 2; foldI++) {
      panelZ = WIN_Z + (foldI === 0 ? -0.86 : 0.86);
      for (var f = 0; f < 5; f++) {
        foldZ = panelZ + (f - 2) * 0.062;
        curtain.cyl(0.042 + (f % 2) * 0.008, 1.02, 8, winX + 0.175, 1.55, foldZ);
      }
      /* 底部卷边，让布帘不像一排柱子 */
      curtain.box(0.075, 0.05, 0.32, winX + 0.175, 1.04, panelZ);
    }
  }

  /* ================= bed ================= */
  var legX = [BED_X - 0.44, BED_X + 0.44];
  var legZ = [BED_HEAD + 0.14, BED_FOOT - 0.14];
  var li;
  for (li = 0; li < 2; li++) {
    for (var lz = 0; lz < 2; lz++) {
      metal.box(0.055, 0.42, 0.055, legX[li], 0.21, legZ[lz]);
      dark.cyl(0.035, 0.03, 10, legX[li], 0.032, legZ[lz], 0, 0, Math.PI / 2);
    }
  }
  /* 床架横梁 */
  metal.box(0.045, 0.1, BED_LEN - 0.08, BED_X - 0.485, 0.44, BED_CZ);
  metal.box(0.045, 0.1, BED_LEN - 0.08, BED_X + 0.485, 0.44, BED_CZ);
  metal.box(BED_W - 0.06, 0.1, 0.045, BED_X, 0.44, BED_HEAD + 0.05);
  metal.box(BED_W - 0.06, 0.1, 0.045, BED_X, 0.44, BED_FOOT - 0.05);
  for (var s = 0; s < 4; s++) {
    metal.box(BED_W - 0.12, 0.02, 0.06, BED_X, 0.485, BED_HEAD + 0.32 + s * 0.46);
  }

  /* 床垫 + 床单（略微外露的包边） */
  linen.box(BED_W - 0.05, 0.18, BED_LEN - 0.06, BED_X, 0.585, BED_CZ);
  linen.box(BED_W, 0.022, BED_LEN - 0.02, BED_X, 0.683, BED_CZ);
  linen.box(0.022, 0.2, BED_LEN - 0.02, BED_X - (BED_W / 2), 0.58, BED_CZ);
  linen.box(0.022, 0.2, BED_LEN - 0.02, BED_X + (BED_W / 2), 0.58, BED_CZ);
  linen.box(BED_W, 0.2, 0.022, BED_X, 0.58, BED_FOOT - 0.03);

  /* 床头板：木饰面 + 圆润上沿 + 金属立柱 */
  wood.box(BED_W, 0.62, 0.05, BED_X, 0.92, BED_HEAD - 0.035, 1, 1);
  wood.cyl(0.028, BED_W, 8, BED_X, 1.235, BED_HEAD - 0.035, 0, 0, Math.PI / 2);
  metal.box(0.04, 0.9, 0.04, BED_X - 0.47, 0.72, BED_HEAD - 0.035);
  metal.box(0.04, 0.9, 0.04, BED_X + 0.47, 0.72, BED_HEAD - 0.035);

  /* 床尾板：白色塑面 + 金属顶杆 */
  plastic.box(BED_W - 0.02, 0.46, 0.045, BED_X, 0.74, BED_FOOT + 0.025);
  metal.cyl(0.022, BED_W, 10, BED_X, 0.985, BED_FOOT + 0.025, 0, 0, Math.PI / 2);
  plastic.box(0.06, 0.08, 0.05, BED_X + 0.44, 0.55, BED_FOOT + 0.03);
  plastic.box(0.06, 0.08, 0.05, BED_X - 0.44, 0.55, BED_FOOT + 0.03);

  /* 侧护栏：内外两侧都做，顶杆 + 立杆 + 白色护板 */
  var railX = [BED_X - 0.52, BED_X + 0.52];
  for (li = 0; li < 2; li++) {
    metal.cyl(0.017, 0.78, 10, railX[li], 0.985, BED_CZ + 0.16, Math.PI / 2, 0, 0);
    plastic.box(0.015, 0.115, 0.74, railX[li], 0.9, BED_CZ + 0.16);
    for (var bi = 0; bi < 3; bi++) {
      metal.cyl(0.011, 0.34, 8, railX[li], 0.82, BED_CZ + 0.16 + (bi - 1) * 0.25);
    }
    metal.box(0.05, 0.05, 0.06, railX[li], 0.66, BED_CZ + 0.53);
  }

  /* 被子：主体 + 头端卷边 + 两侧/床尾垂布 + 三道褶皱 */
  var duvetHead = -1.02;
  var duvetEnd = 0.245;
  var duvetLen = duvetEnd - duvetHead;
  var duvetCz = (duvetHead + duvetEnd) / 2;
  blanket.box(BED_W + 0.04, 0.055, duvetLen, BED_X, 0.72, duvetCz);
  blanket.cyl(0.03, BED_W + 0.04, 10, BED_X, 0.735, duvetHead, 0, 0, Math.PI / 2);
  blanket.box(0.022, 0.26, duvetLen, BED_X - (BED_W / 2) - 0.035, 0.62, duvetCz);
  blanket.box(0.022, 0.26, duvetLen, BED_X + (BED_W / 2) + 0.035, 0.62, duvetCz);
  blanket.box(BED_W + 0.07, 0.2, 0.022, BED_X, 0.66, duvetEnd + 0.012);
  blanket.cyl(0.019, BED_W - 0.02, 8, BED_X, 0.752, -0.72, 0, 0, Math.PI / 2);
  blanket.cyl(0.016, BED_W - 0.04, 8, BED_X, 0.751, -0.38, 0, 0, Math.PI / 2);
  blanket.cyl(0.014, BED_W - 0.08, 8, BED_X, 0.749, -0.08, 0, 0, Math.PI / 2);
  /* 翻折回来的床单，出现两层不同白的层次 */
  linen.box(BED_W + 0.02, 0.02, 0.26, BED_X, 0.706, -1.16);
  linen.box(BED_W + 0.02, 0.02, 0.1, BED_X, 0.7, -0.98);
  /* 床尾加的薄毯，压出折角 */
  blanket.boxR(0.62, 0.03, 0.42, BED_X + 0.14, 0.762, -0.3, 0, 0.06, 0);

  /* 枕头：两个椭球 + 一个靠枕垫 */
  linen.sphere(0.225, 0.075, 0.135, BED_X - 0.23, 0.8, BED_HEAD + 0.22, 14, 9, -0.32, 0.05, 0);
  linen.sphere(0.225, 0.075, 0.135, BED_X + 0.23, 0.8, BED_HEAD + 0.22, 14, 9, -0.32, -0.03, 0);
  linen.boxR(0.9, 0.07, 0.34, BED_X, 0.735, BED_HEAD + 0.2, -0.16, 0, 0);

  /* ================= nightstand ================= */
  dark.cyl(0.032, 0.03, 8, CAB_X - 0.18, 0.032, CAB_Z - 0.14, 0, 0, Math.PI / 2);
  dark.cyl(0.032, 0.03, 8, CAB_X + 0.18, 0.032, CAB_Z - 0.14, 0, 0, Math.PI / 2);
  dark.cyl(0.032, 0.03, 8, CAB_X - 0.18, 0.032, CAB_Z + 0.14, 0, 0, Math.PI / 2);
  dark.cyl(0.032, 0.03, 8, CAB_X + 0.18, 0.032, CAB_Z + 0.14, 0, 0, Math.PI / 2);
  wood.box(0.46, 0.54, 0.4, CAB_X, 0.36, CAB_Z);
  plastic.box(0.5, 0.03, 0.44, CAB_X, CAB_TOP - 0.015, CAB_Z);
  plastic.box(0.42, 0.155, 0.016, CAB_X, 0.475, CAB_Z + 0.205);
  plastic.box(0.42, 0.155, 0.016, CAB_X, 0.3, CAB_Z + 0.205);
  metal.box(0.11, 0.014, 0.014, CAB_X, 0.52, CAB_Z + 0.222);
  metal.box(0.11, 0.014, 0.014, CAB_X, 0.345, CAB_Z + 0.222);
  /* 台面物件：水杯、纸巾盒、折叠毛巾、平板 */
  plastic.cylT(0.036, 0.03, 0.1, 12, CAB_X - 0.15, CAB_TOP + 0.05, CAB_Z + 0.06);
  plastic.box(0.12, 0.055, 0.15, CAB_X + 0.09, CAB_TOP + 0.028, CAB_Z - 0.08);
  linen.box(0.07, 0.02, 0.1, CAB_X + 0.09, CAB_TOP + 0.066, CAB_Z - 0.08);
  linen.box(0.19, 0.032, 0.15, CAB_X - 0.13, CAB_TOP + 0.016, CAB_Z - 0.1);
  linen.box(0.17, 0.028, 0.13, CAB_X - 0.13, CAB_TOP + 0.046, CAB_Z - 0.1);
  dark.boxR(0.13, 0.008, 0.18, CAB_X + 0.12, CAB_TOP + 0.005, CAB_Z + 0.13, 0, 0.22, 0);

  /* ================= head wall unit ================= */
  var hwZ = -ROOM_D / 2;
  metal.box(1.6, 0.14, 0.035, BED_X, 1.42, hwZ + 0.02);
  var oi;
  for (oi = 0; oi < 4; oi++) {
    plastic.box(0.07, 0.09, 0.018, BED_X - 0.6 + oi * 0.4, 1.42, hwZ + 0.042);
    dark.box(0.05, 0.05, 0.012, BED_X - 0.6 + oi * 0.4, 1.42, hwZ + 0.052);
  }
  /* 阅读灯 */
  metal.cyl(0.014, 0.22, 8, BED_X + 0.62, 1.55, hwZ + 0.11, Math.PI / 2, 0, 0);
  metal.cylT(0.05, 0.035, 0.06, 10, BED_X + 0.62, 1.53, hwZ + 0.2);
  glow.cyl(0.042, 0.008, 10, BED_X + 0.62, 1.5, hwZ + 0.2);
  /* 呼叫器 + 挂线 */
  plastic.boxR(0.06, 0.1, 0.03, BED_X + 0.95, 1.2, hwZ + 0.025, 0.12, 0, 0);
  dark.cyl(0.004, 0.28, 6, BED_X + 0.95, 1.05, hwZ + 0.05);
  /* 床号牌 */
  glow.box(0.16, 0.08, 0.004, BED_X - 0.72, 1.62, hwZ + 0.021);

  /* ================= monitor cart ================= */
  dark.cyl(0.2, 0.032, 16, MON_X, 0.07, MON_Z);
  dark.cyl(0.032, 0.03, 8, MON_X - 0.15, 0.032, MON_Z - 0.15, 0, 0, Math.PI / 2);
  dark.cyl(0.032, 0.03, 8, MON_X + 0.15, 0.032, MON_Z - 0.15, 0, 0, Math.PI / 2);
  dark.cyl(0.032, 0.03, 8, MON_X - 0.15, 0.032, MON_Z + 0.15, 0, 0, Math.PI / 2);
  dark.cyl(0.032, 0.03, 8, MON_X + 0.15, 0.032, MON_Z + 0.15, 0, 0, Math.PI / 2);
  metal.cyl(0.022, 1.02, 10, MON_X, 0.6, MON_Z);
  plastic.box(0.3, 0.02, 0.2, MON_X, 1.1, MON_Z);
  plastic.box(0.26, 0.015, 0.16, MON_X, 1.14, MON_Z + 0.02);
  /* 机身 + 前框 + 按键 */
  dark.box(0.44, 0.32, 0.09, MON_X, MON_Y, MON_Z);
  plastic.box(0.46, 0.34, 0.02, MON_X, MON_Y, MON_Z + 0.05);
  var ki;
  for (ki = 0; ki < 3; ki++) {
    plastic.cyl(0.011, 0.008, 8, MON_X - 0.08 + ki * 0.08, MON_Y - 0.185, MON_Z + 0.062, Math.PI / 2, 0, 0);
  }
  /* 电缆：从机身背后垂到推车，再拉向病床 */
  dark.cyl(0.006, 0.4, 6, MON_X + 0.16, 1.14, MON_Z - 0.06, 0.28, 0, 0.14);
  dark.cyl(0.005, 0.6, 6, MON_X - 0.1, 1.0, MON_Z - 0.02, 0, 0, 0.9);
  dark.cyl(0.005, 0.7, 6, MON_X - 0.38, 0.92, MON_Z + 0.06, 0, 0.5, 1.1);

  /* 屏幕底版 */
  var screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.26),
    screenMat
  );
  screenMesh.name = 'ward-monitor-screen';
  screenMesh.position.set(MON_X, MON_Y, MON_Z + 0.0605);
  world.add(screenMesh);

  /* 滚动的心电波形条：只改 texture offset，不重新上传像素 */
  var ecgMesh = null;
  if (ecgTex) {
    ecgMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.355, 0.105), ecgMat);
    ecgMesh.name = 'ward-monitor-ecg';
    ecgMesh.position.set(MON_X, MON_Y - 0.062, MON_Z + 0.0625);
    ecgMesh.renderOrder = 2;
    world.add(ecgMesh);
  }

  /* ================= IV stand ================= */
  var ivI, ivAng;
  for (ivI = 0; ivI < 5; ivI++) {
    ivAng = (ivI / 5) * Math.PI * 2;
    metal.boxR(0.26, 0.014, 0.03, IV_X + Math.cos(ivAng) * 0.13, 0.05,
      IV_Z + Math.sin(ivAng) * 0.13, 0, -ivAng, 0);
    dark.cyl(0.028, 0.026, 8, IV_X + Math.cos(ivAng) * 0.25, 0.03,
      IV_Z + Math.sin(ivAng) * 0.25, 0, 0, Math.PI / 2);
  }
  metal.cyl(0.015, 1.8, 10, IV_X, 0.94, IV_Z);
  metal.cyl(0.011, 0.36, 8, IV_X, 1.96, IV_Z);
  metal.box(0.17, 0.014, 0.014, IV_X + 0.07, 2.12, IV_Z);
  metal.box(0.014, 0.05, 0.014, IV_X + 0.14, 2.09, IV_Z);
  /* 输液袋 + 滴壶 + 管路 */
  plastic.boxR(0.1, 0.19, 0.028, IV_X + 0.09, 1.98, IV_Z, 0, 0, 0.05);
  glow.box(0.06, 0.07, 0.004, IV_X + 0.09, 1.95, IV_Z + 0.0165);
  plastic.cylT(0.016, 0.012, 0.06, 10, IV_X + 0.09, 1.855, IV_Z);
  dark.cyl(0.004, 0.5, 6, IV_X + 0.09, 1.59, IV_Z + 0.01, 0.06, 0, 0.05);
  dark.cyl(0.004, 0.5, 6, IV_X + 0.14, 1.35, IV_Z + 0.06, 0, 0, 1.15);

  /* ================= chair ================= */
  var chairLegs = [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]];
  var ci;
  for (ci = 0; ci < 4; ci++) {
    metal.cyl(0.014, 0.44, 8, CHAIR_X + chairLegs[ci][0], 0.22, CHAIR_Z + chairLegs[ci][1]);
    dark.cyl(0.022, 0.02, 8, CHAIR_X + chairLegs[ci][0], 0.026, CHAIR_Z + chairLegs[ci][1], 0, 0, Math.PI / 2);
  }
  curtain.box(0.46, 0.1, 0.44, CHAIR_X, 0.48, CHAIR_Z);
  curtain.sphere(0.23, 0.035, 0.22, CHAIR_X, 0.532, CHAIR_Z, 12, 6, 0, 0, 0);
  curtain.box(0.05, 0.42, 0.42, CHAIR_X + 0.21, 0.72, CHAIR_Z, 1, 1);
  metal.box(0.03, 0.03, 0.42, CHAIR_X + 0.21, 0.94, CHAIR_Z);
  metal.box(0.03, 0.36, 0.03, CHAIR_X + 0.2, 0.2, CHAIR_Z - 0.19);
  metal.box(0.03, 0.36, 0.03, CHAIR_X + 0.2, 0.2, CHAIR_Z + 0.19);
  metal.box(0.04, 0.03, 0.4, CHAIR_X - 0.02, 0.66, CHAIR_Z - 0.21);
  metal.box(0.04, 0.03, 0.4, CHAIR_X - 0.02, 0.66, CHAIR_Z + 0.21);
  metal.cyl(0.013, 0.2, 8, CHAIR_X - 0.02, 0.56, CHAIR_Z - 0.21);
  metal.cyl(0.013, 0.2, 8, CHAIR_X - 0.02, 0.56, CHAIR_Z + 0.21);
  linen.box(0.3, 0.05, 0.24, CHAIR_X - 0.04, 0.55, CHAIR_Z);

  /* ================= wall decor ================= */
  /* 壁挂托盘（可注视目标所在） */
  wood.box(0.55, 0.025, 0.2, 1.45, 1.28, -2.5, 1, 1);
  metal.box(0.03, 0.13, 0.02, 1.24, 1.2, hwZ + 0.015);
  metal.box(0.03, 0.13, 0.02, 1.66, 1.2, hwZ + 0.015);
  plastic.cylT(0.03, 0.024, 0.11, 10, 1.34, 1.35, -2.5);
  linen.box(0.1, 0.02, 0.13, 1.55, 1.3, -2.5);

  /* 挂钟：表盘 + 刻度 + 时针分针，秒针单独一个 mesh 在 update 里转 */
  var clockX = 1.5;
  var clockY = 2.0;
  var clockZ = hwZ + 0.016;
  plastic.cyl(0.125, 0.03, 20, clockX, clockY, clockZ, Math.PI / 2, 0, 0);
  metal.cyl(0.132, 0.018, 20, clockX, clockY, clockZ - 0.012, Math.PI / 2, 0, 0);
  glow.cyl(0.112, 0.004, 20, clockX, clockY, clockZ + 0.017, Math.PI / 2, 0, 0);
  var ti;
  for (ti = 0; ti < 12; ti++) {
    var tickA = (ti / 12) * Math.PI * 2;
    dark.boxR(0.006, ti % 3 === 0 ? 0.02 : 0.012, 0.003,
      clockX + Math.sin(tickA) * 0.096, clockY + Math.cos(tickA) * 0.096,
      clockZ + 0.02, 0, 0, -tickA);
  }
  var hourGeo = new THREE.BoxGeometry(0.008, 0.06, 0.004);
  hourGeo.translate(0, 0.018, 0);
  dark.add(hourGeo, clockX, clockY, clockZ + 0.026, 0, 0, 1.1);
  var minuteGeo = new THREE.BoxGeometry(0.007, 0.088, 0.004);
  minuteGeo.translate(0, 0.032, 0);
  dark.add(minuteGeo, clockX, clockY, clockZ + 0.026, 0, 0, -1.05);
  dark.cyl(0.008, 0.006, 8, clockX, clockY, clockZ + 0.028, Math.PI / 2, 0, 0);

  var secondHandGeo = new THREE.BoxGeometry(0.005, 0.088, 0.003);
  secondHandGeo.translate(0, 0.036, 0);
  var secondHandMat = new THREE.MeshBasicMaterial({ color: 0xb14434 });
  secondHandMat.name = 'ward-clock-hand';
  var secondHand = new THREE.Mesh(secondHandGeo, secondHandMat);
  secondHand.name = 'ward-clock-second';
  secondHand.position.set(clockX, clockY, clockZ + 0.031);
  world.add(secondHand);

  /* 右墙：告示牌 + 手消液 + 提示 */
  var wallRX = ROOM_W / 2 - 0.012;
  plastic.box(0.024, 0.5, 0.38, wallRX - 0.012, 1.66, -0.9);
  glow.box(0.006, 0.44, 0.32, wallRX - 0.027, 1.66, -0.9);
  var li2;
  for (li2 = 0; li2 < 4; li2++) {
    dark.box(0.004, 0.014, 0.2 - li2 * 0.035, wallRX - 0.031, 1.82 - li2 * 0.06, -0.9);
  }
  plastic.box(0.07, 0.16, 0.09, wallRX - 0.035, 1.26, 0.35);
  metal.cyl(0.008, 0.04, 8, wallRX - 0.035, 1.36, 0.35);
  dark.box(0.01, 0.05, 0.05, wallRX - 0.07, 1.19, 0.35);

  /* 门（前墙）+ 门框 + 观察窗 + 把手 + 防踢板 */
  var doorX = -1.1;
  var doorZ = ROOM_D / 2 - 0.022;
  wood.box(0.95, 2.05, 0.035, doorX, 1.025, doorZ);
  plastic.box(1.07, 0.06, 0.05, doorX, 2.1, doorZ - 0.006);
  plastic.box(0.06, 2.11, 0.05, doorX - 0.51, 1.055, doorZ - 0.006);
  plastic.box(0.06, 2.11, 0.05, doorX + 0.51, 1.055, doorZ - 0.006);
  /* 门观察窗：玻璃片 + 四边压条 */
  glow.box(0.22, 0.26, 0.006, doorX + 0.02, 1.6, doorZ - 0.021);
  plastic.box(0.26, 0.024, 0.012, doorX + 0.02, 1.742, doorZ - 0.026);
  plastic.box(0.26, 0.024, 0.012, doorX + 0.02, 1.458, doorZ - 0.026);
  plastic.box(0.024, 0.31, 0.012, doorX - 0.09, 1.6, doorZ - 0.026);
  plastic.box(0.024, 0.31, 0.012, doorX + 0.13, 1.6, doorZ - 0.026);
  metal.box(0.05, 0.16, 0.03, doorX + 0.35, 1.02, doorZ - 0.03);
  metal.box(0.04, 0.3, 0.008, doorX - 0.4, 0.32, doorZ - 0.026);
  plastic.box(0.07, 0.11, 0.012, -0.45, 1.22, ROOM_D / 2 - 0.006);

  /* 送风口 + 天花开孔细节（后墙高处） */
  plastic.box(0.5, 0.28, 0.025, 1.75, 2.3, hwZ + 0.013);
  metal.box(0.44, 0.02, 0.02, 1.75, 2.22, hwZ + 0.032);
  metal.box(0.44, 0.02, 0.02, 1.75, 2.3, hwZ + 0.032);
  metal.box(0.44, 0.02, 0.02, 1.75, 2.38, hwZ + 0.032);
  /* 喷淋头 + 烟感 */
  metal.cyl(0.014, 0.05, 8, 0.6, ROOM_H - 0.03, 0.2);
  metal.cyl(0.03, 0.008, 10, 0.6, ROOM_H - 0.058, 0.2);
  dark.cyl(0.058, 0.022, 12, -1.4, ROOM_H - 0.012, 0.9);

  /* ================= ceiling panels ================= */
  var panelGeo = new THREE.BoxGeometry(0.9, 0.022, 0.3);
  var panelPositions = high
    ? [[-1.1, -1.3], [-1.1, 1.3], [1.1, -1.3], [1.1, 1.3]]
    : [[-0.7, 0], [0.7, 0]];
  var pi;
  for (pi = 0; pi < panelPositions.length; pi++) {
    plastic.box(0.96, 0.035, 0.36, panelPositions[pi][0], ROOM_H - 0.03, panelPositions[pi][1]);
  }
  var panels = new THREE.InstancedMesh(panelGeo, glowMat, panelPositions.length);
  panels.name = 'ward-ceiling-panels';
  panels.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  var tmpMatrix = new THREE.Matrix4();
  for (pi = 0; pi < panelPositions.length; pi++) {
    /* 发光面比灯框低 1.5 cm：从下方看得到灯盘，而不是一块塑料板 */
    tmpMatrix.makeTranslation(panelPositions[pi][0], ROOM_H - 0.052, panelPositions[pi][1]);
    panels.setMatrixAt(pi, tmpMatrix);
  }
  panels.instanceMatrix.needsUpdate = true;
  panels.matrixAutoUpdate = false;
  panels.updateMatrix();
  world.add(panels);

  /* ================= contact shadows ================= */
  if (shadowTex) {
    var shadows = new Batch(THREE);
    shadows.plane(1.9, 2.6, BED_X, 0.004, BED_CZ, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.9, 0.9, MON_X, 0.004, MON_Z, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.85, 0.7, CAB_X, 0.004, CAB_Z, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.7, 0.7, IV_X, 0.004, IV_Z, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.85, 0.85, CHAIR_X, 0.004, CHAIR_Z, -Math.PI / 2, 0, 1, 1);
    shadows.plane(0.5, 0.45, doorX, 0.004, ROOM_D / 2 - 0.4, -Math.PI / 2, 0, 1, 1);
    var shadowMesh = shadows.build(shadowMat, 'ward-contact-shadows');
    if (shadowMesh) {
      shadowMesh.renderOrder = 1;
      world.add(shadowMesh);
    }
  }

  /* ================= build batches ================= */
  var woodMesh = wood.build(matWood, 'ward-wood-batch');
  if (woodMesh) { world.add(woodMesh); }
  var plasticMesh = plastic.build(matPlastic, 'ward-plastic-batch');
  if (plasticMesh) { world.add(plasticMesh); }
  var metalMesh = metal.build(matMetal, 'ward-metal-batch');
  if (metalMesh) { world.add(metalMesh); }
  var darkMesh = dark.build(matDark, 'ward-dark-batch');
  if (darkMesh) { world.add(darkMesh); }
  var linenMesh = linen.build(matLinen, 'ward-linen-batch');
  if (linenMesh) { world.add(linenMesh); }
  var blanketMesh = blanket.build(matBlanket, 'ward-blanket-batch');
  if (blanketMesh) { world.add(blanketMesh); }
  var curtainMesh = curtain.build(matCurtain, 'ward-curtain-batch');
  if (curtainMesh) { world.add(curtainMesh); }
  var glowMesh = glow.build(glowMat, 'ward-glow-batch');
  if (glowMesh) { world.add(glowMesh); }

  /* ================= interaction targets ================= */
  var targetGeo = high
    ? new THREE.IcosahedronGeometry(0.1, 0)
    : new THREE.BoxGeometry(0.17, 0.17, 0.17);
  var targetDefs = [
    { color: 0xff5c5c, alpha: 0xff2f2f, label: 'nightstand', pos: [CAB_X, CAB_TOP + 0.15, CAB_Z + 0.09] },
    { color: 0x5fd38d, alpha: 0x36c878, label: 'footboard', pos: [BED_X, 1.14, BED_FOOT + 0.03] },
    { color: 0xe3b341, alpha: 0xe0a317, label: 'wall-shelf', pos: [1.45, 1.5, -2.47] }
  ];
  var selectables = [];
  var tgi;
  for (tgi = 0; tgi < targetDefs.length; tgi++) {
    var def = targetDefs[tgi];
    var targetMat = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.alpha,
      emissiveIntensity: 0.35,
      roughness: 0.32,
      metalness: 0.12,
      flatShading: true
    });
    targetMat.name = 'ward-target-' + (tgi + 1);
    var target = new THREE.Mesh(targetGeo, targetMat);
    target.name = 'ward-target-' + (tgi + 1);
    target.position.set(def.pos[0], def.pos[1], def.pos[2]);
    target.rotation.set(0.15 * tgi, 0.6 * tgi, 0);
    target.userData.selectable = true;
    target.userData.targetId = tgi + 1;
    target.userData.label = def.label;
    world.add(target);
    selectables.push(target);
  }

  /* ================= budget stats ================= */
  var triangleCount = 0;
  var drawCalls = 0;
  var lightCount = 0;

  scene.traverse(function (obj) {
    if (obj.isLight) {
      lightCount++;
    }
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
    if (obj.isInstancedMesh) {
      tris *= obj.count;
    }
    triangleCount += tris;
  });

  var textureBytes = 0;
  var textureCount = 0;
  var textureList = [floorTex, wallTex, woodTex, fabricTex, skyTex, screenTex, ecgTex, shadowTex];
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
    lights: lightCount,
    textures: textureCount,
    textureBytes: textureBytes,
    quality: quality
  };
  world.userData.stats = stats;

  if (typeof console !== 'undefined' && console.log) {
    console.log('[WardScene]', quality, stats);
  }

  /* ================= animation ================= */
  var PULSE = 2.6;
  var pulseClock = 0;
  var pulseOn = true;
  var ecgOffset = 0;
  var handAngle = 0;
  var disposed = false;

  function update(dt) {
    if (!isNum(dt) || dt < 0) {
      dt = 0;
    }
    if (dt > 0.1) {
      dt = 0.1;
    }

    /* 心电波形滚动：只改 offset，纹理不上传 */
    if (ecgTex) {
      ecgOffset = (ecgOffset - dt * 0.09) % 1;
      if (ecgOffset < 0) {
        ecgOffset += 1;
      }
      ecgTex.offset.x = ecgOffset;
    }

    /* 屏幕刷新律动：40–50 Hz 的弱闪烁，只改颜色 */
    pulseClock += dt;
    if (pulseClock >= PULSE) {
      pulseClock -= PULSE;
      pulseOn = !pulseOn;
      screenMat.color.setHex(pulseOn ? 0xffffff : 0xe4efe9);
    }

    /* 挂钟秒针：60 秒一圈 */
    handAngle -= dt * (Math.PI / 30);
    if (handAngle < -Math.PI * 2) {
      handAngle += Math.PI * 2;
    }
    secondHand.rotation.z = handAngle;
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
