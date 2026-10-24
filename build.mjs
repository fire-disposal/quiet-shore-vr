import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const serve = process.argv.includes('--serve');
const standalone = process.argv.includes('--standalone');
const root = process.cwd();
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  target: ['chrome67'],
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
  minify: !serve,
  loader: { '.mp3': 'dataurl' }
};

await esbuild.build({
  ...common,
  entryPoints: [path.join(src, 'main.ts')],
  outfile: path.join(dist, 'app.js'),
  format: 'iife'
});

await esbuild.build({
  ...common,
  entryPoints: [path.join(src, 'styles.css')],
  outfile: path.join(dist, 'styles.css')
});

const template = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const version = crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(dist, 'app.js')))
  .update(fs.readFileSync(path.join(dist, 'styles.css')))
  .digest('hex')
  .slice(0, 10);

const page = template
  .replace('<!-- APP_CSS -->', `<link rel="stylesheet" href="styles.css?v=${version}">`)
  .replace('<!-- APP_JS -->', `<script src="app.js?v=${version}"></script>`);
fs.writeFileSync(path.join(dist, 'index.html'), page);

if (standalone) {
  const js = fs.readFileSync(path.join(dist, 'app.js'), 'utf8')
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync(path.join(dist, 'styles.css'), 'utf8');
  const single = template
    .replace('<!-- APP_CSS -->', () => `<style>\n${css}\n</style>`)
    .replace('<!-- APP_JS -->', () => `<script>\n${js}\n</script>`);
  fs.writeFileSync(path.join(dist, 'standalone.html'), single);
  const kb = (Buffer.byteLength(single) / 1024).toFixed(0);
  console.log(`standalone.html ${kb} KB`);
}

// Tablet mirror: one self-contained page loaded by the control APK's WebView.
// It is deliberately separate from the patient page so it can never grow a
// session state machine or a second control path.
await esbuild.build({
  ...common,
  sourcemap: false,
  entryPoints: [path.join(src, 'mirror/main.ts')],
  outfile: path.join(dist, 'mirror.js'),
  format: 'iife'
});
const mirrorJs = fs.readFileSync(path.join(dist, 'mirror.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');
const mirrorPage = [
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>静岸 场景镜像</title></head><body>',
  '<script>',
  mirrorJs,
  '</script></body></html>'
].join('');
fs.writeFileSync(path.join(dist, 'mirror.html'), mirrorPage);
console.log(`mirror.html ${(Buffer.byteLength(mirrorPage) / 1024).toFixed(0)} KB`);

// Voice cues: pre-generated clips ship inside the headset APK, not the bundle.
// The page fetches them from the loopback (`/voice/<set>/<id>.mp3`), so they are
// copied verbatim and never inlined as data URLs.
const voiceDir = path.join(root, 'voice');
if (fs.existsSync(voiceDir)) {
  const voiceOut = path.join(dist, 'voice');
  fs.cpSync(voiceDir, voiceOut, { recursive: true });
  let bytes = 0;
  let count = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.mp3')) {
        bytes += fs.statSync(full).size;
        count += 1;
      }
    }
  };
  walk(voiceOut);
  console.log(`voice ${count} clips, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (count === 0) {
    console.log('  (no clips yet: fill .env.local and run scripts/voice/build.py)');
  }
}

if (serve) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.join(dist, rel);
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  server.listen(8125, '127.0.0.1', () => {
    console.log('dev server: http://127.0.0.1:8125/');
  });
}
