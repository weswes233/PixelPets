import { Buffer } from 'buffer';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function decodeBase58(text: string): Buffer | null {
  let value = 0n;
  for (const character of text) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const hex = value === 0n ? '' : value.toString(16);
  const body = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  return Buffer.concat([Buffer.alloc(text.match(/^1*/)?.[0].length ?? 0), body]);
}

function decodeBase32(text: string): Buffer | null {
  const output: number[] = [];
  let value = 0;
  let bits = 0;
  for (const character of text) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) return null;
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push(value >>> bits);
      value &= (1 << bits) - 1;
    }
  }
  // A canonical unpadded base32 string has fewer than five unused zero bits.
  return bits < 5 && value === 0 ? Buffer.from(output) : null;
}

function supportedCid(text: string): boolean {
  if (text.length === 46 && text.startsWith('Qm')) {
    const bytes = decodeBase58(text);
    return bytes !== null && bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 32;
  }
  // Deliberately accept the two usual IPFS encodings, not IPNS names or arbitrary hosts.
  const bytes = text.startsWith('b') ? decodeBase32(text.slice(1))
    : text.startsWith('z') ? decodeBase58(text.slice(1)) : null;
  if (!bytes) return false;
  let offset = 0;
  const varint = (): number | null => {
    let result = 0;
    for (let index = 0; index < 5 && offset < bytes.length; index++) {
      const byte = bytes[offset++];
      result += (byte & 127) * 2 ** (index * 7);
      if (byte < 128) return (index > 0 && byte === 0) || result > 0xffffffff ? null : result;
    }
    return null;
  };
  const version = varint();
  const codec = varint();
  const hash = varint();
  const length = varint();
  // Metadata may be raw JSON, dag-pb UnixFS, dag-cbor, or dag-json. Keep this
  // conservative allowlist explicit instead of accepting unknown hash functions.
  return version === 1 && codec !== null && [0x55, 0x70, 0x71, 0x0129].includes(codec)
    && ((hash === 0x12 && length === 32) || (hash === 0x13 && length === 64))
    && bytes.length - offset === length;
}

function canonicalPath(path: string): boolean {
  if (path === '' || path === '/') return true;
  return path.slice(1).split('/').every(segment => {
    if (!/^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/.test(segment)) return false;
    try {
      const decoded = decodeURIComponent(segment);
      return decoded !== '.' && decoded !== '..' && !/[\x00-\x20\x7f/\\%?#]/.test(decoded);
    } catch { return false; }
  });
}

/** Syntax only: does not fetch, pin, verify file bytes, or prove metadata availability. */
export function isImmutableMetadataUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || Buffer.byteLength(uri) > 200) return false;
  const match = /^(ipfs|ar):\/\/([^/?#]+)(\/[^?#]*)?$/.exec(uri);
  if (!match || !canonicalPath(match[3] ?? '')) return false;
  if (match[1] === 'ipfs') return supportedCid(match[2]);
  const id = match[2];
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return false;
  const bytes = Buffer.from(id, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === id;
}
