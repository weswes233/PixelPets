#!/usr/bin/env python3
"""Extract the 120-entry design codex (docs/plan/03-pet-codex-120.md) into game/data/codex.json.
Only D1 entries have art; everything else is a silhouette marked Coming later (design concept, not issued)."""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
family = None; out = []
for line in (root / 'docs/plan/03-pet-codex-120.md').read_text(encoding='utf-8').splitlines():
    m = re.match(r'^### (\d+)\. (.+?) / (.+)$', line)
    if m: family = {'n': int(m[1]), 'zh': m[2].strip(), 'en': m[3].strip()}; continue
    if not line.startswith('| P'): continue
    cells = [c.strip() for c in line.strip('|').split('|')]
    pid, names, silhouette, _, forms, rarity, stage = cells[:7]
    zh, en = [x.strip() for x in names.split('/', 1)]
    out.append({'id': pid, 'family': family, 'name': {'zh': zh, 'en': en}, 'silhouette_note': {'zh': silhouette},
                'rarity': rarity, 'stage': stage, 'available': stage == 'D1',
                'species_id': {'P001': 'moss', 'P002': 'puddle', 'P003': 'wisp'}.get(pid)})
assert len(out) == 120 and len({e['id'] for e in out}) == 120, len(out)
(root / 'game/data').mkdir(exist_ok=True)
(root / 'game/data/codex.json').write_text(json.dumps({'version': '2026-10-09', 'note': 'Design catalogue, not an issued list.', 'entries': out}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(len(out), 'entries;', sum(e['available'] for e in out), 'available')
