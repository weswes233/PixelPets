import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature } from '@wallet-standard/features';
import type { SolanaSignMessageFeature } from '@solana/wallet-standard-features';
import { runPetTransaction, TransactionFlowError } from './transactions.ts';
import type { DeploymentConfig, TransactionReview, IntentKind } from './transactions.ts';

export class BridgeError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'BridgeError'; this.code = code; }
}
export type ApiCall = (path: string, method: string, token?: string, body?: unknown) => Promise<any>;
export type WalletState = { connected: boolean; authenticated: boolean; address: string; network: string; chain_enabled: boolean; market_enabled: boolean };
export type RecoveryState = WalletState & { recovered: true; game_token: string; user_id: string; game_expires_at: string };
export type ChainConfig = DeploymentConfig;

export async function httpApi(path: string, method: string, token?: string, body?: unknown): Promise<any> {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'same-origin', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new BridgeError(payload?.error?.code || 'SERVICE_UNAVAILABLE', payload?.error?.message || '服务暂时不可用，请稍后再试。');
  return payload.data;
}

function networkId(value: string): string {
  if (value === 'mainnet-beta') value = 'mainnet';
  const normalized = value.startsWith('solana:') ? value : `solana:${value}`;
  if (!['solana:devnet', 'solana:mainnet', 'solana:testnet', 'solana:localnet'].includes(normalized))
    throw new BridgeError('NETWORK_UNSUPPORTED', '服务返回了不支持的网络。');
  return normalized;
}

export function isSolanaWallet(wallet: Wallet): boolean {
  return wallet.chains.some(chain => chain.startsWith('solana:')) && Boolean(wallet.features['standard:connect']);
}

export class WalletController {
  private api: ApiCall;
  private guestToken = '';
  private walletSessionToken = '';
  private wallet: Wallet | null = null;
  private account: WalletAccount | null = null;
  private removeEvents: (() => void) | null = null;
  private version = 0;
  private busy = false;
  private changed: (state: WalletState) => void;
  private config: ChainConfig = { enabled: false, network: 'solana:devnet' };
  private review: (summary: TransactionReview) => Promise<boolean>;
  constructor(api: ApiCall = httpApi, changed: (state: WalletState) => void = () => {}, review: (summary: TransactionReview) => Promise<boolean> = async () => false) { this.api = api; this.changed = changed; this.review = review; }

  state(): WalletState {
    return { connected: Boolean(this.account), authenticated: Boolean(this.walletSessionToken), address: this.account?.address || '', network: this.config.network, chain_enabled: this.config.enabled, market_enabled: this.config.market_enabled === true };
  }

  setSession(token: unknown): WalletState {
    if (typeof token !== 'string' || token.length < 16 || token.length > 512 || /\s/.test(token))
      throw new BridgeError('SESSION_INVALID', '请先进入宠物档案。');
    if (this.guestToken && this.guestToken !== token) this.clearConnection();
    this.guestToken = token;
    return this.state();
  }

  async refresh(): Promise<WalletState> {
    const version = this.version;
    const token = this.walletSessionToken;
    const config = await this.api('/chain/config', 'GET');
    if (version !== this.version) return this.state();
    this.config = { ...config, enabled: config.enabled === true, network: networkId(config.network) };
    if (token) {
      try { await this.api('/wallet/session', 'GET', token); }
      catch (error) {
        if (version !== this.version || token !== this.walletSessionToken) return this.state();
        if (error instanceof BridgeError && ['UNAUTHORIZED', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'INVALID_TOKEN'].includes(error.code)) this.clearConnection();
        else throw error;
      }
    }
    return this.state();
  }

  async connect(wallet: Wallet): Promise<WalletState> { return this.authenticate(wallet, 'bind'); }

  async recover(wallet: Wallet): Promise<RecoveryState> { return this.authenticate(wallet, 'recover') as Promise<RecoveryState>; }

  private async authenticate(wallet: Wallet, mode: 'bind' | 'recover'): Promise<WalletState | RecoveryState> {
    if (mode === 'bind' && !this.guestToken) throw new BridgeError('SESSION_REQUIRED', '先领养或载入宠物档案，再连接钱包。');
    if (this.busy) throw new BridgeError('WALLET_BUSY', '钱包正在处理上一次请求。');
    if (!isSolanaWallet(wallet)) throw new BridgeError('WALLET_UNSUPPORTED', '请选择支持 Solana 的钱包。');
    this.busy = true;
    this.clearConnection();
    const operationVersion = this.version;
    try {
      await this.refresh();
      if (operationVersion !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包或档案已变化，请重新连接。');
      const connect = wallet.features['standard:connect'] as StandardConnectFeature['standard:connect'];
      const result = await connect.connect();
      const account = result.accounts.find(item => item.chains.includes(this.config.network as `${string}:${string}`));
      if (!account) throw new BridgeError('WRONG_NETWORK', `钱包未提供 ${this.config.network} 账户，请检查钱包网络。`);
      if (operationVersion !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包已切换，请重新连接。');
      this.wallet = wallet; this.account = account;
      const events = wallet.features['standard:events'] as StandardEventsFeature['standard:events'] | undefined;
      if (events) this.removeEvents = events.on('change', change => {
        if (change.accounts && !change.accounts.some(a => a.address === account.address && a.chains.includes(this.config.network as `${string}:${string}`))) {
          this.clearConnection(); this.changed(this.state());
        }
      });
      const feature = wallet.features['solana:signMessage'] as SolanaSignMessageFeature['solana:signMessage'] | undefined;
      if (!feature || !account.features.includes('solana:signMessage')) throw new BridgeError('SIGN_MESSAGE_UNSUPPORTED', '此钱包不支持登录签名，请换用支持消息签名的钱包。');
      const prefix = mode === 'recover' ? '/wallet/recovery' : '/wallet';
      const authToken = mode === 'recover' ? undefined : this.guestToken;
      const challenge = await this.api(`${prefix}/challenge`, 'POST', authToken, { address: account.address });
      if (operationVersion !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包已切换，请重新连接。');
      const message = new TextEncoder().encode(challenge.message);
      const [proof] = await feature.signMessage({ account, message });
      if (!proof || proof.signature.length !== 64 || proof.signedMessage.length !== message.length || !message.every((b, i) => b === proof.signedMessage[i]))
        throw new BridgeError('SIGNATURE_INVALID', '钱包返回的签名内容不匹配。');
      if (operationVersion !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包已切换，请重新连接。');
      const signature = btoa(String.fromCharCode(...proof.signature));
      const verified = await this.api(`${prefix}/verify`, 'POST', authToken, { challenge_id: challenge.challenge_id, signature });
      if (operationVersion !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包已切换，请重新连接。');
      if (verified.wallet_address !== account.address || typeof verified.token !== 'string' || !verified.token)
        throw new BridgeError('SESSION_INVALID', '服务端未确认该钱包，请重新连接。');
      if (mode === 'recover') {
        if (typeof verified.game_token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(verified.game_token)
          || typeof verified.user_id !== 'string' || !/^[a-f0-9-]{36}$/.test(verified.user_id)
          || typeof verified.network !== 'string' || networkId(verified.network) !== this.config.network
          || typeof verified.game_expires_at !== 'string' || !(Date.parse(verified.game_expires_at) > Date.now()))
          throw new BridgeError('RECOVERY_INVALID', '恢复结果不完整，当前档案保持不变，请重新验证。');
        this.guestToken = verified.game_token;
      }
      this.walletSessionToken = verified.token;
      this.changed(this.state());
      if (mode === 'recover') return { ...this.state(), recovered: true, game_token: verified.game_token,
        user_id: verified.user_id, game_expires_at: verified.game_expires_at };
      return this.state();
    } catch (error) {
      this.clearConnection();
      this.changed(this.state());
      throw error;
    } finally { this.busy = false; }
  }

  private clearConnection(): void {
    this.version += 1;
    this.removeEvents?.(); this.removeEvents = null;
    this.walletSessionToken = ''; this.account = null; this.wallet = null;
  }

  async disconnect(): Promise<WalletState> {
    const wallet = this.wallet;
    const token = this.walletSessionToken;
    this.clearConnection(); this.changed(this.state());
    // Locally revoke access immediately, even if a network request or the wallet fails.
    await Promise.allSettled([
      token ? this.api('/wallet/session', 'DELETE', token) : Promise.resolve(),
      (wallet?.features['standard:disconnect'] as StandardDisconnectFeature['standard:disconnect'] | undefined)?.disconnect(),
    ]);
    return this.state();
  }

  async register(petId: unknown): Promise<unknown> { return this.petTransaction(petId, 'claim'); }

  async checkpoint(petId: unknown): Promise<unknown> { return this.petTransaction(petId, 'checkpoint'); }

  /** Saves one revealed trip as a checkpoint v2 journey receipt. The wallet review shows the trip commitment. */
  async journeyReceipt(petId: unknown, tripId: unknown, resultHash: unknown): Promise<unknown> {
    if (typeof tripId !== 'string' || !/^[a-f0-9-]{36}$/.test(tripId) || typeof resultHash !== 'string' || !/^[a-f0-9]{64}$/.test(resultHash))
      throw new BridgeError('INVALID_REQUEST', 'This journey receipt request is invalid. Refresh the trip and try again.');
    return this.petTransaction(petId, 'checkpoint', { tripId, resultHash });
  }

  /** Trips of wallet-registered pets use the wallet session (ownership fence); the guest token is never upgraded. */
  async travel(op: unknown, petId: unknown, tripId?: unknown, body?: unknown): Promise<unknown> {
    this.requirePetId(petId);
    const event = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{32,36}$/.test(value);
    const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    if (op === 'current') return this.walletOperation(`/pets/${encodeURIComponent(String(petId))}/trips/current`, 'GET', undefined);
    if (op === 'start') {
      if (Object.keys(input).some(key => !['event_id', 'route_id', 'packing_id'].includes(key)) || !event(input.event_id)
        || typeof input.route_id !== 'string' || typeof input.packing_id !== 'string') throw new BridgeError('INVALID_REQUEST', 'This trip request is invalid.');
      return this.walletOperation(`/pets/${encodeURIComponent(String(petId))}/trips`, 'POST', input);
    }
    if (op === 'reveal') {
      if (typeof tripId !== 'string' || !/^[a-f0-9-]{36}$/.test(tripId) || Object.keys(input).some(key => key !== 'event_id') || !event(input.event_id))
        throw new BridgeError('INVALID_REQUEST', 'This postcard request is invalid.');
      return this.walletOperation(`/trips/${encodeURIComponent(tripId)}/reveal`, 'POST', input);
    }
    throw new BridgeError('METHOD_UNSUPPORTED', 'This travel action is not supported.');
  }

  async syncAssets(): Promise<unknown> { return this.walletOperation('/wallet/assets/sync', 'POST', {}); }

  async care(petId: unknown, payload: unknown): Promise<unknown> {
    this.requirePetId(petId);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BridgeError('INVALID_REQUEST', '照顾记录无效，请重试。');
    const value = payload as Record<string, unknown>;
    if (Object.keys(value).some(key => !['action', 'event_id', 'choice'].includes(key))
      || !['feed', 'play', 'rest', 'explore'].includes(String(value.action))
      || typeof value.event_id !== 'string' || !/^[a-f0-9]{32}$/.test(value.event_id)
      || (value.choice !== undefined && !['sun', 'moon'].includes(String(value.choice))))
      throw new BridgeError('INVALID_REQUEST', '照顾记录无效，请重试。');
    return this.walletOperation(`/pets/${encodeURIComponent(String(petId))}/care`, 'POST', value);
  }

  async rename(petId: unknown, nickname: unknown): Promise<unknown> {
    this.requirePetId(petId);
    if (typeof nickname !== 'string' || !nickname.trim() || [...nickname.trim()].length > 16)
      throw new BridgeError('INVALID_REQUEST', '请给伙伴取一个 1 到 16 字的名字。');
    return this.walletOperation(`/pets/${encodeURIComponent(String(petId))}`, 'PATCH', { nickname: nickname.trim() });
  }

  private requirePetId(petId: unknown): void {
    if (typeof petId !== 'string' || !/^[a-f0-9-]{36}$/.test(petId)) throw new BridgeError('PET_REQUIRED', '请选择要照顾的伙伴。');
  }

  private async walletOperation(path: string, method: string, body: unknown): Promise<unknown> {
    if (!this.walletSessionToken || !this.account) throw new BridgeError('WALLET_AUTH_REQUIRED', '请先连接并验证钱包，再照顾链上伙伴。');
    if (this.busy) throw new BridgeError('WALLET_BUSY', '钱包正在处理上一次请求。');
    this.busy = true;
    const version = this.version;
    try {
      // The wallet credential stays in this controller; daily care never submits a chain transaction.
      const result = await this.api(path, method, this.walletSessionToken, body);
      if (version !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包或档案已变化，请重新连接后刷新伙伴。');
      return result;
    } catch (error) {
      if (version === this.version && error instanceof BridgeError && ['UNAUTHORIZED', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'INVALID_TOKEN'].includes(error.code)) {
        this.clearConnection(); this.changed(this.state());
      }
      throw error;
    } finally { this.busy = false; }
  }

  private async petTransaction(petId: unknown, kind: IntentKind, options?: { tripId: string; resultHash: string }): Promise<unknown> {
    const startingVersion = this.version;
    await this.refresh();
    if (startingVersion !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包或档案已变化，请重新连接后核对伙伴。');
    if (!this.config.enabled) throw new BridgeError('CHAIN_NOT_DEPLOYED', '链上登记尚未开放，你的养成进度会继续保存。');
    if (!this.walletSessionToken) throw new BridgeError('WALLET_AUTH_REQUIRED', '请先连接并验证钱包。');
    if (typeof petId !== 'string' || !petId) throw new BridgeError('PET_REQUIRED', '请选择要登记的宠物。');
    if (this.busy) throw new BridgeError('WALLET_BUSY', '钱包正在处理上一次请求。');
    if (!this.wallet || !this.account) throw new BridgeError('WALLET_AUTH_REQUIRED', '请先连接钱包。');
    this.busy = true;
    const version = this.version;
    try {
      return await runPetTransaction({ api: this.api, token: this.walletSessionToken, wallet: this.wallet, account: this.account, config: this.config, review: this.review,
        assertCurrent: () => { if (this.version !== version) throw new BridgeError('ACCOUNT_CHANGED', '钱包或档案已变化，请重新连接后核对交易。'); } }, petId, kind, options);
    } catch (error) {
      if (error instanceof TransactionFlowError) throw new BridgeError(error.code, error.message);
      if (error instanceof BridgeError) throw error;
      // Diagnostic only: the error class and message (no keys, tokens or transaction bytes).
      console.warn('[PixelPets] transaction flow stopped:', (error as Error)?.name, String((error as Error)?.message ?? error).slice(0, 300));
      throw new BridgeError('TRANSACTION_NOT_COMPLETED', '交易尚未完成，请核对钱包提示与网络状态后重试。');
    } finally { this.busy = false; }
  }

  async offers(cursor?: unknown): Promise<unknown> {
    const version = this.version;
    await this.refresh();
    if (version !== this.version) throw new BridgeError('ACCOUNT_CHANGED', '钱包或档案已变化，请刷新报价。');
    if (!this.config.market_enabled) throw new BridgeError('CHAIN_NOT_DEPLOYED', '市场报价尚未开放。你可以先养成想要交换的伙伴。');
    if (cursor !== undefined && (typeof cursor !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cursor))) throw new BridgeError('INVALID_CURSOR', '报价页码无效，请刷新。');
    if (!this.guestToken) throw new BridgeError('SESSION_REQUIRED', '请先载入伙伴档案。');
    return this.api('/offers' + (cursor ? `?cursor=${encodeURIComponent(String(cursor))}` : ''), 'GET', this.walletSessionToken || this.guestToken);
  }
}
