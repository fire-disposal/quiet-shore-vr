#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncQuestionnaires, verifyVoiceAssets, voiceSynthesisIds } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const verifyOnly = process.argv.includes('--verify');
const synthesize = process.argv.includes('--voice');
const skipVoice = process.argv.includes('--no-voice-check');

try {
  if (!verifyOnly) {
    const result = syncQuestionnaires(root, { check, writeDist: !check });
    console.log(`${check ? 'checked' : 'generated'} ${result.questionnaires.length} questionnaires (${result.contentId})`);
  }
  if (synthesize) {
    const stale = voiceSynthesisIds(root);
    if (stale.length) {
      console.log(`synthesizing ${stale.length} missing/stale lines in both voice sets`);
      const generated = spawnSync('uv', [
        'run', '--with', 'websockets', 'python', 'scripts/voice/build.py',
        '--voice', 'all', '--only', stale.join(','), '--update'
      ], { cwd: root, stdio: 'inherit' });
      if (generated.status !== 0) process.exit(generated.status ?? 1);
    } else {
      console.log('voice packs already current');
    }
  }
  if (!skipVoice) {
    const count = verifyVoiceAssets(root);
    console.log(`verified ${count} lines in male/female voice packs`);
  }
  if (!check && !verifyOnly) {
    const catalog = spawnSync('python3', ['scripts/voice/build.py', '--catalog'], { cwd: root, stdio: 'inherit' });
    if (catalog.status !== 0) process.exit(catalog.status ?? 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
