// Keep the design catalogue available on a fresh checkout, using the project's Node runtime.
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('docs/plan/03-pet-codex-120.md', root), 'utf8');
const entries = [];
let family;
for (const line of source.split(/\r?\n/)) {
  const heading = /^### (\d+)\. (.+?) \/ (.+)$/.exec(line);
  if (heading) {
    family = { n: Number(heading[1]), zh: heading[2].trim(), en: heading[3].trim() };
    continue;
  }
  if (!line.startsWith('| P')) continue;
  const [id, names, silhouette, , , rarity, stage] = line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const slash = names.indexOf('/');
  if (!family || slash < 0) throw new Error(`Invalid codex row: ${id}`);
  entries.push({ id, family, name: { zh: names.slice(0, slash).trim(), en: names.slice(slash + 1).trim() },
    silhouette_note: { zh: silhouette }, rarity, stage, available: stage === 'D1',
    species_id: { P001: 'moss', P002: 'puddle', P003: 'wisp' }[id] ?? null });
}
if (entries.length !== 120 || new Set(entries.map(entry => entry.id)).size !== 120) {
  throw new Error('The design catalogue must have 120 unique entries.');
}
await mkdir(new URL('game/data/', root), { recursive: true });
await writeFile(new URL('game/data/codex.json', root), JSON.stringify({ version: '2026-10-09',
  note: 'Design catalogue, not an issued list.', entries }, null, 1) + '\n');
console.log(`Codex: ${entries.length} entries; ${entries.filter(entry => entry.available).length} available.`);
