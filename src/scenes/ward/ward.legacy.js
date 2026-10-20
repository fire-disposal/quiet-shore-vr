/*!
 * WardScene 1.0.0
 * Procedural training-ward scene for Three.js r128 (PICO G2 4K / Adreno 540).
 *
 * Plain script: no modules, no bundler, ES5 syntax only.
 * Exposes window.WardScene.createWorld(THREE, opts).
 *
 * Contract:
 *   var built = WardScene.createWorld(THREE, { quality: 'high', eyeHeight: 1.6 });
 *   built.scene        THREE.Scene
 *   built.world        THREE.Group containing every mesh and light (floor at local y = 0)
 *   built.update(dt)   cheap animation tick, seconds
 *   built.selectables  array of 3 Meshes with userData.selectable === true
 *   built.dispose()    releases geometries, materials and generated textures
 *
 * The room is authored at real-world scale so WebXR `local` space can be fixed with
 *   world.position.y = -world.userData.eyeHeight;
 * while a 2D preview keeps world.position.y = 0.
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var BG_COLOR = 0x080c11;
  var FOG_COLOR = 0x080c11;

  /* 房间尺寸（米） */
  var ROOM_W = 4.6;   /* x */
  var ROOM_D = 5.2;   /* z */
  var ROOM_H = 2.7;   /* y */

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
    tex.encoding = THREE.sRGBEncoding;
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

  /* 医用塑胶地板：0.6 m 见方，一张 256² 纹理代表 1.2 m */
  function paintFloor(ctx, w, h) {
    var rnd = seeded(0x51f3a7);
    var i, x, y, tone;
    ctx.fillStyle = '#b3bdc2';
    ctx.fillRect(0, 0, w, h);
    for (y = 0; y < 2; y++) {
      for (x = 0; x < 2; x++) {
        tone = 176 + Math.floor(rnd() * 14);
        ctx.fillStyle = 'rgb(' + tone + ',' + (tone + 6) + ',' + (tone + 9) + ')';
        ctx.fillRect(x * 128 + 1, y * 128 + 1, 126, 126);
      }
    }
    ctx.strokeStyle = 'rgba(96,110,118,0.55)';
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
    for (i = 0; i < 1400; i++) {
      ctx.fillStyle = 'rgba(108,122,130,' + (0.03 + rnd() * 0.07).toFixed(3) + ')';
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  }

  /* 墙面：浅灰绿乳胶漆，带 1.2 m 板缝 */
  function paintWall(ctx, w, h) {
    var rnd = seeded(0x2b71c1);
    var i;
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#e4eae6');
    grad.addColorStop(0.6, '#dce3df');
    grad.addColorStop(1, '#d3dbd7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(146,156,154,0.26)';
    ctx.fillRect(0, 0, 2, h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(2, 0, 2, h);
    for (i = 0; i < 420; i++) {
      ctx.fillStyle = 'rgba(118,130,126,' + (0.02 + rnd() * 0.05).toFixed(3) + ')';
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
    }
  }

  /* 监护仪屏幕：静态心电波形 + 数值，256x128（POT，WebGL1 安全） */
  function paintScreen(ctx, w, h) {
    var x, y, phase, spike;
    ctx.fillStyle = '#061014';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(40,120,110,0.28)';
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

    ctx.strokeStyle = '#59f2b3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (x = 0; x <= w; x += 2) {
      phase = (x % 64) / 64;
      spike = 0;
      if (phase > 0.40 && phase < 0.45) {
        spike = -24;
      } else if (phase > 0.45 && phase < 0.49) {
        spike = 11;
      }
      y = 94 + Math.sin((x / w) * Math.PI * 6) * 2 + spike;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#7dffc4';
    ctx.fillText('HR', 12, 22);
    ctx.font = 'bold 26px monospace';
    ctx.fillText('72', 46, 23);
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#62d9ff';
    ctx.fillText('SpO2 98%', 152, 22);
    ctx.fillStyle = '#ffd36b';
    ctx.fillText('NIBP 118/76', 12, 46);
    ctx.fillStyle = 'rgba(120,240,200,0.55)';
    ctx.font = '11px monospace';
    ctx.fillText('LEAD II 25mm/s', 150, 46);

    ctx.strokeStyle = 'rgba(90,240,190,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  /* 接地阴影贴片：一张柔和径向渐变，合并成一个透明批次 */
  function paintShadow(ctx, w, h) {
    var grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.72)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.38)');
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
      throw new Error('WardScene.createWorld: THREE is required');
    }
    opts = opts || {};
    var quality = opts.quality === 'low' ? 'low' : 'high';
    var eyeHeight = isNum(opts.eyeHeight) ? opts.eyeHeight : 1.6;
    var high = quality === 'high';

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, 6, 15);

    var world = new THREE.Group();
    world.name = 'ward';
    world.userData.eyeHeight = eyeHeight;
    world.userData.quality = quality;
    scene.add(world);

    /* ---------------- lights (2, no shadows) ---------------- */
    var hemi = new THREE.HemisphereLight(0xe2edfd, 0x4d565e, 0.68);
    hemi.name = 'ward-hemi';
    world.add(hemi);

    var sun = new THREE.DirectionalLight(0xfff3e2, 0.6);
    sun.name = 'ward-key';
    sun.position.set(-2.4, 3.2, 1.6);
    world.add(sun);

    /* ---------------- textures & materials ---------------- */
    var floorTex = high
      ? createCanvasTexture(THREE, 256, 256, paintFloor, true)
      : null;
    var wallTex = high
      ? createCanvasTexture(THREE, 128, 128, paintWall, true)
      : null;
    var screenTex = createCanvasTexture(THREE, 256, 128, paintScreen, false);
    var shadowTex = createCanvasTexture(THREE, 128, 128, paintShadow, false);

    var maxAniso = 4;
    if (floorTex) { floorTex.anisotropy = maxAniso; }
    if (wallTex) { wallTex.anisotropy = maxAniso; }

    var matFloor;
    if (high) {
      matFloor = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: floorTex,
        roughness: 0.55,
        metalness: 0.02
      });
    } else {
      matFloor = new THREE.MeshLambertMaterial({ color: 0x98a3a8 });
    }
    matFloor.name = 'ward-floor';

    var matShell;
    if (high) {
      matShell = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: wallTex,
        roughness: 0.92,
        metalness: 0.0
      });
    } else {
      matShell = new THREE.MeshLambertMaterial({ color: 0xd6ded9 });
    }
    matShell.name = 'ward-shell';

    var matMetal = new THREE.MeshStandardMaterial({
      color: 0x8f9aa4, roughness: 0.36, metalness: 0.78
    });
    matMetal.name = 'ward-metal';

    var matPlastic = new THREE.MeshStandardMaterial({
      color: 0xeceff0, roughness: 0.5, metalness: 0.03
    });
    matPlastic.name = 'ward-plastic';

    var matDark = new THREE.MeshStandardMaterial({
      color: 0x2a3138, roughness: 0.48, metalness: 0.18
    });
    matDark.name = 'ward-dark';

    var matLaminate = new THREE.MeshStandardMaterial({
      color: 0xcbbfa9, roughness: 0.62, metalness: 0.0
    });
    matLaminate.name = 'ward-laminate';

    var matLinen = new THREE.MeshStandardMaterial({
      color: 0xf3f5f2, roughness: 0.96, metalness: 0.0
    });
    matLinen.name = 'ward-linen';

    var matBlanket = new THREE.MeshStandardMaterial({
      color: 0x4d8199, roughness: 1.0, metalness: 0.0
    });
    matBlanket.name = 'ward-blanket';

    var screenMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: screenTex
    });
    if (!screenTex) {
      screenMat.color.setHex(0x1fe08a);
    }
    screenMat.name = 'ward-screen';

    var glowMat = new THREE.MeshBasicMaterial({ color: 0xdceeff });
    glowMat.name = 'ward-glow';

    /* 天花单独一层：朝下的面吃不到主光，用不受光材质避免发黑 */
    var ceilingMat = new THREE.MeshBasicMaterial({ color: 0xc3ccd1 });
    ceilingMat.name = 'ward-ceiling';

    var windowMat = new THREE.MeshBasicMaterial({ color: 0xcfe4f2 });
    windowMat.name = 'ward-window';

    var shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: shadowTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    shadowMat.name = 'ward-contact-shadow';

    /* ---------------- shell: floor, walls, ceiling ---------------- */
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
    shell.plane(ROOM_W, ROOM_H, 0, ROOM_H / 2, -ROOM_D / 2, 0, 0, wallU, wallV);            /* 后墙 */
    shell.plane(ROOM_D, ROOM_H, -ROOM_W / 2, ROOM_H / 2, 0, 0, Math.PI / 2, wallU, wallV);   /* 左墙 */
    shell.plane(ROOM_D, ROOM_H, ROOM_W / 2, ROOM_H / 2, 0, 0, -Math.PI / 2, wallU, wallV);   /* 右墙 */
    shell.plane(ROOM_W, ROOM_H, 0, ROOM_H / 2, ROOM_D / 2, 0, Math.PI, wallU, wallV);        /* 前墙 */
    var shellMesh = shell.build(matShell, 'ward-shell-mesh');
    if (shellMesh) { world.add(shellMesh); }

    /* 天花单独一层：朝下的法线拿不到主光，用不受光材质保持干净 */
    var ceilingBatch = new Batch(THREE);
    ceilingBatch.plane(ROOM_W, ROOM_D, 0, ROOM_H, 0, Math.PI / 2, 0, 1, 1);
    var ceilingMesh = ceilingBatch.build(ceilingMat, 'ward-ceiling-mesh');
    if (ceilingMesh) { world.add(ceilingMesh); }

    /* ---------------- bed ---------------- */
    var metal = new Batch(THREE);
    var plastic = new Batch(THREE);
    var dark = new Batch(THREE);
    var laminate = new Batch(THREE);
    var linen = new Batch(THREE);
    var blanket = new Batch(THREE);

    /* 踢脚线与防撞扶手（并入塑料批次） */
    plastic.box(ROOM_W, 0.09, 0.025, 0, 0.045, -ROOM_D / 2 + 0.0125);
    plastic.box(ROOM_W, 0.09, 0.025, 0, 0.045, ROOM_D / 2 - 0.0125);
    plastic.box(0.025, 0.09, ROOM_D, -ROOM_W / 2 + 0.0125, 0.045, 0);
    plastic.box(0.025, 0.09, ROOM_D, ROOM_W / 2 - 0.0125, 0.045, 0);
    plastic.box(ROOM_W, 0.10, 0.03, 0, 0.95, -ROOM_D / 2 + 0.015);
    plastic.box(0.03, 0.10, ROOM_D, -ROOM_W / 2 + 0.015, 0.95, 0);
    plastic.box(0.03, 0.10, ROOM_D, ROOM_W / 2 - 0.015, 0.95, 0);

    var bedX = -1.2;
    var bedZ = -1.15;

    laminate.box(1.02, 0.06, 2.04, bedX, 0.52, bedZ);
    laminate.box(1.0, 0.80, 0.06, bedX, 0.80, bedZ - 1.025);   /* 床头板 */
    plastic.box(1.0, 0.55, 0.06, bedX, 0.62, bedZ + 1.025);    /* 床尾板 */
    plastic.box(1.0, 0.30, 0.05, bedX, 1.22, bedZ - 1.025);    /* 床头板上沿 */

    var legX = [bedX - 0.45, bedX + 0.45];
    var legZ = [bedZ - 0.95, bedZ + 0.95];
    var li;
    for (li = 0; li < 2; li++) {
      metal.box(0.07, 0.50, 0.07, legX[li], 0.25, legZ[0]);
      metal.box(0.07, 0.50, 0.07, legX[li], 0.25, legZ[1]);
    }
    /* 侧护栏：白色塑料扶手 + 金属顶杆与立柱 */
    var railX = [bedX - 0.5, bedX + 0.5];
    for (li = 0; li < 2; li++) {
      plastic.box(0.035, 0.24, 0.78, railX[li], 0.82, bedZ - 0.35);
      metal.box(0.042, 0.035, 0.8, railX[li], 0.955, bedZ - 0.35);
      metal.box(0.03, 0.44, 0.03, railX[li], 0.71, bedZ - 0.73);
      metal.box(0.03, 0.44, 0.03, railX[li], 0.71, bedZ + 0.03);
    }

    linen.box(0.98, 0.16, 2.0, bedX, 0.63, bedZ);
    linen.box(0.55, 0.12, 0.32, bedX, 0.77, bedZ - 0.75);
    blanket.box(0.96, 0.05, 1.0, bedX, 0.735, bedZ + 0.48);
    blanket.box(0.94, 0.05, 0.12, bedX, 0.775, bedZ + 0.93);

    /* ---------------- 床头柜 ---------------- */
    var cabX = -0.35;
    var cabZ = -2.32;
    dark.box(0.46, 0.07, 0.38, cabX, 0.035, cabZ);
    laminate.box(0.5, 0.55, 0.42, cabX, 0.345, cabZ);
    plastic.box(0.54, 0.035, 0.46, cabX, 0.6375, cabZ);
    plastic.box(0.42, 0.14, 0.02, cabX, 0.25, cabZ + 0.215);
    plastic.box(0.42, 0.14, 0.02, cabX, 0.47, cabZ + 0.215);
    metal.box(0.12, 0.02, 0.02, cabX, 0.30, cabZ + 0.228);
    metal.box(0.12, 0.02, 0.02, cabX, 0.52, cabZ + 0.228);

    /* ---------------- 监护仪推车 ---------------- */
    var monX = 0.55;
    var monZ = -2.15;
    metal.cylinder(0.24, 0.26, 0.035, 16, monX, 0.02, monZ);
    metal.cylinder(0.022, 0.022, 1.28, 8, monX, 0.66, monZ);
    dark.box(0.44, 0.34, 0.12, monX, 1.32, monZ);
    plastic.box(0.46, 0.05, 0.14, monX, 1.14, monZ);
    metal.box(0.06, 0.02, 0.06, monX, 1.50, monZ);

    var screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.26),
      screenMat
    );
    screenMesh.name = 'ward-monitor-screen';
    screenMesh.position.set(monX, 1.32, monZ + 0.0605);
    world.add(screenMesh);

    /* ---------------- 输液架 ---------------- */
    var ivX = -0.45;
    var ivZ = -1.75;
    metal.cylinder(0.20, 0.21, 0.025, 12, ivX, 0.0125, ivZ);
    metal.cylinder(0.016, 0.016, 1.85, 8, ivX, 0.95, ivZ);
    metal.box(0.16, 0.02, 0.02, ivX, 1.89, ivZ);
    metal.box(0.012, 0.06, 0.012, ivX + 0.06, 1.865, ivZ);
    plastic.box(0.12, 0.19, 0.035, ivX + 0.06, 1.735, ivZ);
    blanket.box(0.09, 0.045, 0.004, ivX + 0.06, 1.77, ivZ + 0.0195);

    /* ---------------- 椅子（面向病床） ---------------- */
    var chairX = 1.15;
    var chairZ = 0.45;
    blanket.box(0.46, 0.06, 0.46, chairX, 0.46, chairZ);
    blanket.box(0.05, 0.44, 0.44, chairX + 0.205, 0.70, chairZ);
    metal.box(0.03, 0.44, 0.03, chairX - 0.19, 0.22, chairZ - 0.19);
    metal.box(0.03, 0.44, 0.03, chairX + 0.19, 0.22, chairZ - 0.19);
    metal.box(0.03, 0.44, 0.03, chairX - 0.19, 0.22, chairZ + 0.19);
    metal.box(0.03, 0.44, 0.03, chairX + 0.19, 0.22, chairZ + 0.19);

    /* ---------------- 墙面挂板架 ---------------- */
    laminate.box(0.55, 0.03, 0.22, 1.45, 1.28, -2.47);
    metal.box(0.03, 0.14, 0.02, 1.24, 1.19, -2.55);
    metal.box(0.03, 0.14, 0.02, 1.66, 1.19, -2.55);

    /* ---------------- 装饰（仅 high） ---------------- */
    if (high) {
      /* 门 */
      laminate.box(0.95, 2.05, 0.035, -1.1, 1.025, ROOM_D / 2 - 0.022);
      plastic.box(1.07, 0.06, 0.05, -1.1, 2.10, ROOM_D / 2 - 0.03);
      plastic.box(0.06, 2.11, 0.05, -1.61, 1.055, ROOM_D / 2 - 0.03);
      plastic.box(0.06, 2.11, 0.05, -0.59, 1.055, ROOM_D / 2 - 0.03);
      metal.box(0.04, 0.14, 0.03, -0.72, 1.02, ROOM_D / 2 - 0.06);

      /* 窗（左墙，冷白采光） */
      var winZ = 0.25;
      var winMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85), windowMat);
      winMesh.name = 'ward-window';
      winMesh.position.set(-ROOM_W / 2 + 0.006, 1.55, winZ);
      winMesh.rotation.y = Math.PI / 2;
      world.add(winMesh);

      plastic.box(0.07, 0.06, 1.58, -ROOM_W / 2 + 0.035, 1.985, winZ);
      plastic.box(0.07, 0.06, 1.58, -ROOM_W / 2 + 0.035, 1.115, winZ);
      plastic.box(0.07, 0.91, 0.06, -ROOM_W / 2 + 0.035, 1.55, winZ - 0.76);
      plastic.box(0.07, 0.91, 0.06, -ROOM_W / 2 + 0.035, 1.55, winZ + 0.76);
      plastic.box(0.06, 0.87, 0.045, -ROOM_W / 2 + 0.045, 1.55, winZ);
      plastic.box(0.06, 0.045, 1.54, -ROOM_W / 2 + 0.045, 1.55, winZ);
      plastic.box(0.14, 0.04, 1.7, -ROOM_W / 2 + 0.07, 1.08, winZ);

      /* 送风口 */
      plastic.box(0.5, 0.28, 0.025, 1.75, 2.3, -ROOM_D / 2 + 0.013);
      metal.box(0.44, 0.02, 0.02, 1.75, 2.22, -ROOM_D / 2 + 0.032);
      metal.box(0.44, 0.02, 0.02, 1.75, 2.30, -ROOM_D / 2 + 0.032);
      metal.box(0.44, 0.02, 0.02, 1.75, 2.38, -ROOM_D / 2 + 0.032);
    }

    /* ---------------- 接地阴影：单批次透明贴片 ---------------- */
    if (shadowTex) {
      var shadows = new Batch(THREE);
      shadows.plane(1.8, 2.7, bedX, 0.004, bedZ, -Math.PI / 2, 0, 1, 1);
      shadows.plane(0.9, 0.9, monX, 0.004, monZ, -Math.PI / 2, 0, 1, 1);
      shadows.plane(0.85, 0.7, cabX, 0.004, cabZ, -Math.PI / 2, 0, 1, 1);
      shadows.plane(0.6, 0.6, ivX, 0.004, ivZ, -Math.PI / 2, 0, 1, 1);
      shadows.plane(0.8, 0.8, chairX, 0.004, chairZ, -Math.PI / 2, 0, 1, 1);
      var shadowMesh = shadows.build(shadowMat, 'ward-contact-shadows');
      if (shadowMesh) {
        shadowMesh.renderOrder = 1;
        world.add(shadowMesh);
      }
    }

    var metalMesh = metal.build(matMetal, 'ward-metal-batch');
    if (metalMesh) { world.add(metalMesh); }
    var plasticMesh = plastic.build(matPlastic, 'ward-plastic-batch');
    if (plasticMesh) { world.add(plasticMesh); }
    var darkMesh = dark.build(matDark, 'ward-dark-batch');
    if (darkMesh) { world.add(darkMesh); }
    var laminateMesh = laminate.build(matLaminate, 'ward-laminate-batch');
    if (laminateMesh) { world.add(laminateMesh); }
    var linenMesh = linen.build(matLinen, 'ward-linen-batch');
    if (linenMesh) { world.add(linenMesh); }
    var blanketMesh = blanket.build(matBlanket, 'ward-blanket-batch');
    if (blanketMesh) { world.add(blanketMesh); }

    /* ---------------- 天花灯盘：InstancedMesh ---------------- */
    var panelGeo = new THREE.BoxGeometry(0.9, 0.022, 0.3);
    var panelPositions = high
      ? [[-1.1, -1.3], [-1.1, 1.3], [1.1, -1.3], [1.1, 1.3]]
      : [[-0.7, 0], [0.7, 0]];
    var panels = new THREE.InstancedMesh(panelGeo, glowMat, panelPositions.length);
    panels.name = 'ward-ceiling-panels';
    panels.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    var tmpMatrix = new THREE.Matrix4();
    var pi;
    for (pi = 0; pi < panelPositions.length; pi++) {
      tmpMatrix.makeTranslation(panelPositions[pi][0], ROOM_H - 0.016, panelPositions[pi][1]);
      panels.setMatrixAt(pi, tmpMatrix);
    }
    panels.instanceMatrix.needsUpdate = true;
    panels.matrixAutoUpdate = false;
    panels.updateMatrix();
    world.add(panels);

    /* ---------------- 交互目标 ---------------- */
    var targetGeo = high
      ? new THREE.IcosahedronGeometry(0.1, 0)
      : new THREE.BoxGeometry(0.17, 0.17, 0.17);
    var targetDefs = [
      { color: 0xff5c5c, alpha: 0xff2f2f, label: 'nightstand', pos: [-0.35, 0.755, -2.22] },
      { color: 0x5fd38d, alpha: 0x36c878, label: 'footboard', pos: [-1.0, 1.0, -0.125] },
      { color: 0xe3b341, alpha: 0xe0a317, label: 'wall-shelf', pos: [1.45, 1.395, -2.47] }
    ];
    var selectables = [];
    var ti;
    for (ti = 0; ti < targetDefs.length; ti++) {
      var def = targetDefs[ti];
      var targetMat = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.alpha,
        emissiveIntensity: 0.35,
        roughness: 0.32,
        metalness: 0.12,
        flatShading: true
      });
      targetMat.name = 'ward-target-' + (ti + 1);
      var target = new THREE.Mesh(targetGeo, targetMat);
      target.name = 'ward-target-' + (ti + 1);
      target.position.set(def.pos[0], def.pos[1], def.pos[2]);
      target.rotation.set(0.15 * ti, 0.6 * ti, 0);
      target.userData.selectable = true;
      target.userData.targetId = ti + 1;
      target.userData.label = def.label;
      world.add(target);
      selectables.push(target);
    }

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
      if (obj.isInstancedMesh) {
        tris *= obj.count;
      }
      triangleCount += tris;
    });

    var textureList = [floorTex, wallTex, screenTex, shadowTex];
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
      lights: 2,
      textures: textureCount,
      textureBytes: textureBytes,
      quality: quality
    };
    world.userData.stats = stats;

    if (typeof console !== 'undefined' && console.log) {
      console.log('[WardScene]', quality, stats);
    }

    /* ---------------- animation ---------------- */
    var PULSE = 1.1;
    var pulseClock = 0;
    var pulseOn = true;
    var disposed = false;

    function update(dt) {
      if (!isNum(dt) || dt < 0) {
        dt = 0;
      }
      if (dt > 0.1) {
        dt = 0.1;
      }
      pulseClock += dt;
      if (pulseClock >= PULSE) {
        pulseClock -= PULSE;
        pulseOn = !pulseOn;
        /* 屏幕刷新闪烁：只改颜色，无分配 */
        screenMat.color.setHex(pulseOn ? 0xffffff : 0xdfeae4);
      }
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

  var api = {
    version: VERSION,
    createWorld: createWorld
  };

  if (root) {
    root.WardScene = api;
  }
}(
  typeof window !== 'undefined'
    ? window
    : (typeof globalThis !== 'undefined' ? globalThis : null)
));
