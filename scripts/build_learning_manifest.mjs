#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'data/dialogues.json');
const outputPath = resolve(root, 'data/learning-manifest.json');
const sourceText = readFileSync(sourcePath, 'utf8');
const dialogues = JSON.parse(sourceText);

if (!Array.isArray(dialogues) || dialogues.length !== 541) {
  throw new Error(`expected the audited 541 Analects entries, received ${Array.isArray(dialogues) ? dialogues.length : 'invalid JSON'}`);
}

const parsed = dialogues.map((entry, index) => {
  const id = Number(entry?.id);
  const title = String(entry?.title || '').trim();
  const match = title.match(/^(?:(.+?)\s+)?(\d+)\.(\d+)$/);
  if (!Number.isInteger(id) || id !== index + 1) throw new Error(`dialogue id must be contiguous at source row ${index + 1}`);
  if (!match) throw new Error(`dialogue ${id} has an invalid title: ${title}`);
  if (!String(entry?.text || '').trim()) throw new Error(`dialogue ${id} has no source text`);
  if (!String(entry?.translation || '').trim()) throw new Error(`dialogue ${id} has no translation learning content`);
  return {
    id,
    title,
    bookName: String(match[1] || '').trim(),
    major: Number(match[2]),
    minor: Number(match[3]),
  };
});

const namesByMajor = new Map();
for (const entry of parsed) {
  if (entry.bookName && !namesByMajor.has(entry.major)) namesByMajor.set(entry.major, entry.bookName);
}

const items = parsed.map((entry) => ({
  resourceKey: `chapter-${entry.id}`,
  itemTitle: entry.title,
  itemGroup: namesByMajor.get(entry.major) || `第 ${entry.major} 篇`,
  itemType: 'chapter',
  chapterId: String(entry.id),
  major: entry.major,
  minor: entry.minor,
}));

const resourceKeys = items.map((item) => item.resourceKey);
if (new Set(resourceKeys).size !== resourceKeys.length) throw new Error('duplicate learning resource keys');

const resourceKeySha256 = createHash('sha256').update(resourceKeys.join('\n')).digest('hex');
const sourceSha256 = createHash('sha256').update(sourceText).digest('hex');
const manifest = {
  schemaVersion: 1,
  siteKey: 'kz',
  manifestVersion: `kz-${resourceKeySha256.slice(0, 16)}`,
  resourceKeySha256,
  sourceSha256,
  sourcePath: 'data/dialogues.json',
  itemCount: items.length,
  completionThreshold: Math.ceil(items.length * 0.3),
  completionContract: {
    evidenceSchema: 'kz-learning-evidence-v1',
    completionKind: 'annotation_revealed',
    description: 'The signed-in learner explicitly reveals the Yang Bojun translation and available annotations for the selected entry. Opening or navigating to an entry is not completion.',
  },
  items,
};
const output = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== output) throw new Error(`stale learning manifest: ${outputPath}`);
} else {
  writeFileSync(outputPath, output);
}

process.stdout.write(`${manifest.siteKey} ${manifest.manifestVersion} ${manifest.itemCount} ${manifest.completionThreshold} ${manifest.resourceKeySha256}\n`);
