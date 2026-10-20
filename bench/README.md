# R3F / Drei synthetic benchmark

See `docs/performance-evidence.md` for results and interpretation.

```bash
npm install --legacy-peer-deps --omit=optional
npm run build
cd dist && python3 -m http.server 8131
```

Open `vanilla-mesh.html`, `vanilla-inst.html`, `r3f.html`, `drei.html`.
Each page writes `window.__bench` when its measurement completes.

Scope: 640×480, no AA, no shadows, `MeshBasicMaterial`, headless Chromium.
Not a PICO G2 4K / Gecko 78 benchmark. Do not use these numbers as device FPS
claims; use them for relative runtime/bundle/mount comparisons.
