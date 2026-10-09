/**
 * Builds content-addressed metadata for the three Devnet editions and the collection.
 * Each file is one raw IPFS block (CIDv1, raw codec, sha2-256), so the URI is fixed by the bytes alone:
 * any IPFS pinning service that stores the same bytes as a single raw block (`ipfs add --cid-version=1`,
 * files < 256 KiB) serves the same CID. Nothing is uploaded by this script.
 * Usage: node tools/build-metadata.ts [--images runtime/metadata/images] [--out deploy/metadata]
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isImmutableMetadataUri } from '../chain-client/src/index.ts';

const args = new Map<string, string>(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const images = resolve(args.get('--images') ?? 'runtime/metadata/images'); const out = resolve(args.get('--out') ?? 'deploy/metadata');
mkdirSync(join(out, 'images'), { recursive: true }); mkdirSync(join(out, 'json'), { recursive: true });
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32(bytes: Buffer): string { let bits = 0, value = 0, text = ''; for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { text += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) text += BASE32[(value << (5 - bits)) & 31]; return text; }
export function rawCid(bytes: Buffer): string {
  if (bytes.length > 262144) throw new Error('File exceeds one raw IPFS block; chunked CIDs would differ by uploader settings');
  return 'b' + base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), createHash('sha256').update(bytes).digest()]));
}
const species = [
  { id: 'moss', index: 0, name: 'Moss', zh: '苔苔', temperament: 'Curious', line: 'A curious little cat who collects sun-warmed stones.' },
  { id: 'puddle', index: 1, name: 'Puddle', zh: '啵啵', temperament: 'Snack-loving', line: 'A wide-mouthed frog who always finds the snacks first.' },
  { id: 'wisp', index: 2, name: 'Wisp', zh: '微光', temperament: 'Cautious', line: 'A shy little ghost who lights the way for friends.' },
];
const manifest: Record<string, unknown> = { schema: 'pixel-pets:metadata-manifest:v1', network: 'devnet', note: 'Devnet test assets. No cash value. Growth forms are shown in the game; the asset image is the immutable base form.', files: [] as unknown[] };
const record = (path: string, bytes: Buffer, kind: string) => { const cid = rawCid(bytes); (manifest.files as unknown[]).push({ path, kind, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), cid, uri: `ipfs://${cid}` }); return cid; };
const editions: Record<string, unknown> = {};
for (const pet of species) {
  const imagePath = join(out, 'images', `${pet.id}-seed.png`); copyFileSync(join(images, `${pet.id}-seed.png`), imagePath);
  const imageBytes = readFileSync(imagePath); const imageCid = record(`images/${pet.id}-seed.png`, imageBytes, 'image/png');
  const json = { name: `PixelPets ${pet.name}`, symbol: 'PXPET', description: `${pet.line} Original code-drawn pixel companion from PixelPets. Solana Devnet test asset with no cash value; growth and journeys are shown in the game and recorded in its PetRecord.`,
    image: `ipfs://${imageCid}`, external_url: '', attributes: [{ trait_type: 'Species', value: pet.name }, { trait_type: 'Species ID', value: pet.id },
      { trait_type: 'Base temperament', value: pet.temperament }, { trait_type: 'Base form', value: 'seed' }, { trait_type: 'Network', value: 'devnet' }],
    properties: { category: 'image', files: [{ uri: `ipfs://${imageCid}`, type: 'image/png' }] } };
  const bytes = Buffer.from(JSON.stringify(json, null, 2) + '\n', 'utf8'); writeFileSync(join(out, 'json', `${pet.id}.json`), bytes);
  const cid = record(`json/${pet.id}.json`, bytes, 'application/json');
  if (!isImmutableMetadataUri(`ipfs://${cid}`)) throw new Error('SDK rejected generated URI');
  editions[pet.id] = { species: pet.index, name: `PixelPets ${pet.name}`, uri: `ipfs://${cid}`, image: `ipfs://${imageCid}` };
}
const collectionImage = readFileSync(join(out, 'images', 'wisp-seed.png'));
const collectionJson = { name: 'PixelPets Devnet Companions', symbol: 'PXPET', description: 'Official PixelPets companions on Solana Devnet. Test assets, no cash value, not migrated to mainnet.',
  image: `ipfs://${rawCid(collectionImage)}`, properties: { category: 'image', files: [{ uri: `ipfs://${rawCid(collectionImage)}`, type: 'image/png' }] } };
const collectionBytes = Buffer.from(JSON.stringify(collectionJson, null, 2) + '\n', 'utf8'); writeFileSync(join(out, 'json', 'collection.json'), collectionBytes);
const collectionCid = record('json/collection.json', collectionBytes, 'application/json');
manifest.collection = { name: 'PixelPets Devnet Companions', uri: `ipfs://${collectionCid}` }; manifest.editions = editions;
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ collection: manifest.collection, editions }, null, 2));
