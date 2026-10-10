// Generate the design catalogue using the project's existing Node dependency.
// D1 entries have art; all later entries remain unissued design concepts.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'docs/plan/03-pet-codex-120.md'), 'utf8');
const entries = [];
let family;
for (const line of source.split(/\r?\n/)) {
  const heading = /^### (\d+)\. (.+?) \/ (.+)$/.exec(line);
  if (heading) { family = { n: Number(heading[1]), zh: heading[2].trim(), en: heading[3].trim() }; continue; }
  if (!line.startsWith('| P')) continue;
  const [id, names, silhouette, , , rarity, stage] = line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const separator = names.indexOf('/');
  assert.ok(family && separator >= 0, `Invalid codex row: ${id}`);
  entries.push({ id, family, name: { zh: names.slice(0, separator).trim(), en: names.slice(separator + 1).trim() },
    silhouette_note: { zh: silhouette }, rarity, stage, available: stage === 'D1',
    species_id: { P001: 'moss', P002: 'puddle', P003: 'wisp' }[id] ?? null });
}
assert.equal(entries.length, 120);
assert.equal(new Set(entries.map(entry => entry.id)).size, 120);
const output = path.join(root, 'game/data');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'codex.json'), JSON.stringify({ version: '2026-10-09', note: 'Design catalogue, not an issued list.', entries }, null, 1) + '\n', 'utf8');
console.log(`Codex built: ${entries.length} entries; ${entries.filter(entry => entry.available).length} available.`);
