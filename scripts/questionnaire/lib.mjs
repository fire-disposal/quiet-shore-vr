import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ID = /^[a-z][a-z0-9-]{0,31}$/;
const VOICE_ID = /^v-[a-z0-9-]+$/;
const MAX_VOICE_LINES = 64;

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function object(value, file, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, `${label} 必须是对象`);
  }
  return value;
}

function keys(value, allowed, file, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(file, `${label} 含未知字段 ${key}`);
  }
}

function text(value, file, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(file, `${label} 必须是 1..${max} 字非空文本`);
  }
  return value.trim();
}

function localized(value, file, label, max) {
  const item = object(value, file, label);
  keys(item, ['zh', 'en'], file, label);
  const zh = text(item.zh, file, `${label}.zh`, max);
  return { zh, en: item.en === undefined ? zh : text(item.en, file, `${label}.en`, max) };
}

function id(value, file, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(file, `${label} 非法：${value}`);
  return value;
}

function voiceId(value, file, label) {
  if (typeof value !== 'string' || !VOICE_ID.test(value)) fail(file, `${label} 非法：${value}`);
  return value;
}

function normalize(raw, file) {
  const source = object(raw, file, '问卷');
  keys(source, ['id', 'order', 'name', 'short', 'completionVoiceId', 'scoring', 'options', 'questions'], file, '问卷');
  const questionnaireId = id(source.id, file, 'id');
  if (path.basename(file, '.json') !== questionnaireId) fail(file, '文件名必须与问卷 id 一致');
  if (!Number.isInteger(source.order)) fail(file, 'order 必须是整数');
  if (!Array.isArray(source.questions) || source.questions.length < 1 || source.questions.length > 100) {
    fail(file, 'questions 必须包含 1..100 题');
  }
  if (!Array.isArray(source.options) || source.options.length < 2 || source.options.length > 7) {
    fail(file, 'options 必须包含 2..7 项');
  }
  const questionIds = new Set();
  const questions = source.questions.map((rawQuestion, index) => {
    const label = `questions[${index}]`;
    const question = object(rawQuestion, file, label);
    keys(question, ['id', 'text', 'voiceId'], file, label);
    const questionId = id(question.id, file, `${label}.id`);
    if (questionIds.has(questionId)) fail(file, `重复题 id ${questionId}`);
    questionIds.add(questionId);
    const clipId = voiceId(question.voiceId, file, `${label}.voiceId`);
    if (!clipId.startsWith(`v-${questionnaireId}-`)) fail(file, `${clipId} 必须以 v-${questionnaireId}- 开头`);
    return { id: questionId, text: localized(question.text, file, `${label}.text`, 120), voiceId: clipId };
  });
  const values = new Set();
  const options = source.options.map((rawOption, index) => {
    const label = `options[${index}]`;
    const option = object(rawOption, file, label);
    keys(option, ['value', 'label'], file, label);
    if (!Number.isInteger(option.value) || option.value < 1 || option.value > 9) fail(file, `${label}.value 必须为 1..9 整数`);
    if (values.has(option.value)) fail(file, `重复选项值 ${option.value}`);
    values.add(option.value);
    const optionLabel = localized(option.label, file, `${label}.label`, 40);
    if (optionLabel.zh.length > 12) fail(file, `${label}.label.zh 不能超过 12 字`);
    return { value: option.value, label: optionLabel };
  });
  let scoring;
  if (source.scoring !== undefined) {
    const rule = object(source.scoring, file, 'scoring');
    keys(rule, ['type'], file, 'scoring');
    if (rule.type !== 'sus' && rule.type !== 'gad7') fail(file, `未知评分规则 ${rule.type}`);
    if (rule.type === 'sus' && (questions.length !== 10 || options.map((option) => option.value).join(',') !== '1,2,3,4,5')) {
      fail(file, 'sus 评分要求十题和 1..5 五个选项');
    }
    if (rule.type === 'gad7' && (questions.length !== 7 || options.map((option) => option.value).join(',') !== '1,2,3,4')) {
      fail(file, 'gad7 评分要求七题和 1..4 四个选项');
    }
    scoring = { type: rule.type };
  }
  return {
    order: source.order,
    questionnaire: {
      id: questionnaireId,
      name: localized(source.name, file, 'name', 80),
      short: localized(source.short, file, 'short', 120),
      completionVoiceId: voiceId(source.completionVoiceId, file, 'completionVoiceId'),
      ...(scoring ? { scoring } : {}),
      questions,
      options
    }
  };
}

export function loadQuestionnaires(root) {
  const directory = path.join(root, 'questionnaires');
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  if (files.length < 1 || files.length > 16) throw new Error('questionnaires/ 必须包含 1..16 份 JSON');
  const seen = new Set();
  const clips = new Set();
  const loaded = files.map((name) => {
    const file = path.join(directory, name);
    const normalized = normalize(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    const q = normalized.questionnaire;
    if (seen.has(q.id)) fail(file, `重复问卷 id ${q.id}`);
    seen.add(q.id);
    for (const question of q.questions) {
      if (clips.has(question.voiceId)) fail(file, `跨问卷重复 voiceId ${question.voiceId}`);
      clips.add(question.voiceId);
    }
    return normalized;
  });
  loaded.sort((a, b) => a.order - b.order || a.questionnaire.id.localeCompare(b.questionnaire.id));
  return loaded.map((entry) => entry.questionnaire);
}

function generatedSource(questionnaires) {
  return `import type { Questionnaire } from './contract';\n\n` +
    `// Generated by scripts/questionnaire/build.mjs. Edit questionnaires/*.json instead.\n` +
    `export const GENERATED_QUESTIONNAIRES = ${JSON.stringify(questionnaires, null, 2)} as const satisfies readonly Questionnaire[];\n`;
}

function nextVoiceDocument(questionnaires, current) {
  const required = new Map();
  for (const questionnaire of questionnaires) {
    for (const question of questionnaire.questions) {
      required.set(question.voiceId, {
        id: question.voiceId,
        group: '问卷',
        questionnaireId: questionnaire.id,
        text: question.text.zh,
        estSec: Math.max(2, Math.ceil(question.text.zh.length / 4)),
        trigger: '问卷逐题'
      });
    }
  }
  const existing = new Map((current.lines || []).map((line) => [line.id, line]));
  const owned = new Set([...required.keys()]);
  for (const line of current.lines || []) {
    if (line.questionnaireId) owned.add(line.id);
  }
  const core = (current.lines || []).filter((line) => !owned.has(line.id) && line.group !== '问卷' && !line.questionnaireId);
  const generated = [...required.values()].map((line) => ({
    ...line,
    estSec: existing.get(line.id)?.estSec || line.estSec
  }));
  const lines = [...core, ...generated];
  if (lines.length > MAX_VOICE_LINES) throw new Error(`语音共 ${lines.length} 条，QS2 六比特索引最多 ${MAX_VOICE_LINES} 条`);
  const known = new Set(lines.map((line) => line.id));
  for (const questionnaire of questionnaires) {
    if (!known.has(questionnaire.completionVoiceId)) throw new Error(`缺少结束语 ${questionnaire.completionVoiceId}`);
  }
  return { ...current, lines };
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

export function createQuestionnaireArtifacts(root) {
  const questionnaires = loadQuestionnaires(root);
  const voicePath = path.join(root, 'voice/lines.json');
  const current = JSON.parse(fs.readFileSync(voicePath, 'utf8'));
  const voice = nextVoiceDocument(questionnaires, current);
  const catalog = `${JSON.stringify({ version: 1, questionnaires }, null, 2)}\n`;
  return {
    questionnaires,
    generated: generatedSource(questionnaires),
    voice: `${JSON.stringify(voice, null, 2)}\n`,
    catalog,
    contentId: crypto.createHash('sha256').update(catalog).digest('hex').slice(0, 16)
  };
}

export function syncQuestionnaires(root, { check = false, writeDist = true } = {}) {
  const artifacts = createQuestionnaireArtifacts(root);
  const outputs = [
    [path.join(root, 'src/questionnaire/generated.ts'), artifacts.generated],
    [path.join(root, 'voice/lines.json'), artifacts.voice]
  ];
  if (writeDist && !check) outputs.push([path.join(root, 'dist/questionnaires.json'), artifacts.catalog]);
  const drift = outputs.filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content);
  if (check && drift.length) {
    throw new Error(`生成物已漂移：${drift.map(([file]) => path.relative(root, file)).join(', ')}`);
  }
  if (!check) for (const [file, content] of outputs) atomicWrite(file, content);
  return artifacts;
}

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function voiceSynthesisIds(root) {
  const lines = JSON.parse(fs.readFileSync(path.join(root, 'voice/lines.json'), 'utf8')).lines;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'voice/manifest.json'), 'utf8'));
  const stale = new Set();
  for (const line of lines) {
    for (const set of ['male', 'female']) {
      const entry = manifest.voices?.[set]?.files?.find((item) => item.id === line.id);
      const file = path.join(root, 'voice', set, `${line.id}.mp3`);
      if (!entry || entry.textHash !== hash(line.text).slice(0, 16) || !fs.existsSync(file)) {
        stale.add(line.id);
        continue;
      }
      const content = fs.readFileSync(file);
      if (entry.bytes !== content.length || entry.sha256 !== hash(content)) stale.add(line.id);
    }
  }
  return [...stale];
}

export function verifyVoiceAssets(root) {
  const { questionnaires } = createQuestionnaireArtifacts(root);
  const lines = JSON.parse(fs.readFileSync(path.join(root, 'voice/lines.json'), 'utf8')).lines;
  const byId = new Map(lines.map((line) => [line.id, line]));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'voice/manifest.json'), 'utf8'));
  const required = new Set(lines.map((line) => line.id));
  for (const questionnaire of questionnaires) {
    for (const question of questionnaire.questions) {
      const line = byId.get(question.voiceId);
      if (!line || line.text !== question.text.zh || line.questionnaireId !== questionnaire.id) {
        throw new Error(`题干与语音文本不一致：${question.voiceId}`);
      }
    }
  }
  for (const set of ['male', 'female']) {
    const entries = manifest.voices?.[set]?.files;
    if (!Array.isArray(entries)) throw new Error(`manifest 缺少 ${set} 语音集`);
    const indexed = new Map(entries.map((entry) => [entry.id, entry]));
    for (const clipId of required) {
      const entry = indexed.get(clipId);
      if (!entry) throw new Error(`缺少 ${set}/${clipId}.mp3 的 manifest 项`);
      const line = byId.get(clipId);
      if (entry.textHash !== hash(line.text).slice(0, 16)) throw new Error(`语音文本已变化，需重生成 ${set}/${clipId}`);
      const file = path.join(root, 'voice', set, `${clipId}.mp3`);
      if (!fs.existsSync(file)) throw new Error(`缺少语音文件 ${path.relative(root, file)}`);
      const content = fs.readFileSync(file);
      if (entry.bytes !== content.length || entry.sha256 !== hash(content)) throw new Error(`语音哈希不一致：${set}/${clipId}`);
    }
  }
  return required.size;
}
