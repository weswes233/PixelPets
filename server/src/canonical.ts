import { createHash } from 'node:crypto';

/**
 * Canonical JSON for fixed-order evidence arrays: UTF-8, no whitespace, only strings,
 * safe integers and nested arrays. Objects, floats, booleans and null are rejected so
 * the same logical value always has exactly one byte encoding. u64 values must be
 * passed as decimal strings by the caller.
 */
export type Canonical = string | number | Canonical[];
export function canonicalJson(value: Canonical): string {
  if (typeof value === 'string') {
    if (value !== value.normalize('NFC')) throw new Error('Canonical strings must be NFC normalized');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Canonical numbers must be safe integers');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  throw new Error('Unsupported canonical value');
}
export const sha256Hex = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
/** Parse and re-encode: proves stored bytes are themselves canonical. */
export function assertCanonical(text: string): Canonical {
  const parsed = JSON.parse(text) as Canonical;
  if (canonicalJson(parsed) !== text) throw new Error('Bytes are not canonical');
  return parsed;
}
