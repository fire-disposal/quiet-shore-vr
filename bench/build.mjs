import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const entries = [
  ['vanilla-mesh', 'src/vanilla-mesh.ts'],
  ['vanilla-inst', 'src/vanilla-inst.ts'],
  ['r3f', 'src/r3f.tsx'],
  ['drei', 'src/drei.tsx']
];

for (const [name, entry] of entries) {
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(dist, `${name}.js`),
    bundle: true,
    minify: true,
    sourcemap: false,
    format: 'iife',
    jsx: 'automatic',
    target: ['chrome80'],
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    logLevel: 'warning'
  });
  fs.writeFileSync(
    path.join(dist, `${name}.html`),
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#0a1211;color:#eef4f0;font:14px monospace}#root{width:640px;height:480px}canvas{display:block}</style><div id="root"></div><script src="${name}.js"></script>`
  );
}

for (const [name] of entries) {
  const size = fs.statSync(path.join(dist, `${name}.js`)).size;
  console.log(`${name}.js ${(size / 1024).toFixed(1)} KB`);
}
