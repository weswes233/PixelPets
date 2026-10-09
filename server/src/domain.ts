import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

export type Form = 'seed' | 'sun' | 'moon';
export type Action = 'feed' | 'play' | 'rest' | 'explore';
export type Pet = {
  id: string; species_id: string; nickname: string; form: Form;
  bond: number; energy: number; mood: number; care_count: number;
  created_at: string; updated_at: string; revision: number;
  traits: { sun: number; moon: number };
  chain: { status: 'unregistered' | 'pending' | 'registered'; network?: string; program_id?: string; asset_address?: string; intent_id?: string; checkpoint?: string; received?: boolean }; favorite: 'sun' | 'moon';
};

export const catalog = {
  species: [
    { id: 'moss', name: '苔苔', description: '对世界充满好奇的小猫。', forms: [
      { id: 'seed', name: '初遇苔苔', description: '刚认识你，还有点害羞。' },
      { id: 'sun', name: '向阳苔苔', description: '把每一次冒险都藏进暖暖的毛色。' },
      { id: 'moon', name: '月影苔苔', description: '喜欢和你一起听安静的夜晚。' },
    ] },
    { id: 'puddle', name: '啵啵', description: '爱发呆也爱听故事的小青蛙。', forms: [
      { id: 'seed', name: '初遇啵啵', description: '小小的水花，慢慢地熟悉你。' },
      { id: 'sun', name: '晴天啵啵', description: '把快乐变成一圈圈水波。' },
      { id: 'moon', name: '夜露啵啵', description: '在月色里收藏你们的小秘密。' },
    ] },
    { id: 'wisp', name: '微光', description: '胆小却愿意陪你走远一点的小幽灵。', forms: [
      { id: 'seed', name: '初遇微光', description: '悄悄亮起一点点。' },
      { id: 'sun', name: '晨曦微光', description: '从你的陪伴里学会了勇敢。' },
      { id: 'moon', name: '星夜微光', description: '把安静变成柔和的星光。' },
    ] },
  ],
};

export class ApiError extends Error {
  status: number; code: string; details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

export function objectBody(input: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'INVALID_INPUT', '请提交 JSON 对象。');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !(key in value))) {
    throw new ApiError(400, 'INVALID_INPUT', '提交的字段不完整或包含未知字段。');
  }
  return value;
}

export function nickname(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_NICKNAME', '请为伙伴取一个名字。');
  const name = value.normalize('NFC').trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 18 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) {
    throw new ApiError(400, 'INVALID_NICKNAME', '名字需要 1–18 个字符，不能包含控制字符。');
  }
  return name;
}
export function eventId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(value)) throw new ApiError(400, 'INVALID_EVENT_ID', '事件标识无效，请重新尝试。');
  return value;
}
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const secret = (): string => randomBytes(32).toString('base64url');
export const iso = (timestamp: number): string => new Date(timestamp).toISOString();
export function requestHash(value: Record<string, unknown>): string {
  return hash(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))));
}

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function addressBytes(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) throw new ApiError(400, 'INVALID_ADDRESS', '钱包地址格式无效。');
  let n = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new ApiError(400, 'INVALID_ADDRESS', '钱包地址格式无效。');
    n = n * 58n + BigInt(digit);
  }
  const digits: number[] = [];
  while (n > 0n) { digits.unshift(Number(n & 255n)); n >>= 8n; }
  const leading = value.match(/^1*/)?.[0].length ?? 0;
  const result = Buffer.concat([Buffer.alloc(leading), Buffer.from(digits)]);
  if (result.length !== 32) throw new ApiError(400, 'INVALID_ADDRESS', '钱包地址必须为 32 字节。');
  return result;
}

export function verifyWalletSignature(address: string, message: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== signature) return false;
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), addressBytes(address)]), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(message, 'utf8'), key, bytes);
}
