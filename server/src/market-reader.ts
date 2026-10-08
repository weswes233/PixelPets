import { Buffer } from 'node:buffer';
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import type { AccountInfo, Connection, GetProgramAccountsResponse } from '@solana/web3.js';
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js';
import { ChainClientError, PixelPetsClient, integer, publicKey, saleAmounts } from '../../chain-client/src/index.ts';
import type { OfferAccount, PetRecordAccount, RpcClient, SupportedNetwork } from '../../chain-client/src/index.ts';
import { ApiError } from './domain.ts';

/** Deliberately contains no wallet, signer, simulation or broadcast operation. */
export type MarketRpc = Pick<Connection, 'getGenesisHash' | 'getAccountInfo' | 'getProgramAccounts' | 'getMultipleAccountsInfoAndContext'>;
export type MarketConfiguration = {
  rpc: MarketRpc; network: SupportedNetwork; programId: string; collectionAddress: string; expectedGenesisHash?: string;
};
export type MarketPetCard = {
  asset_address: string; owner_address: string; edition_address: string; serial: number;
  species_id: 'moss' | 'puddle' | 'wisp'; form: 'seed' | 'sun' | 'moon'; bond: number;
  checkpoint: string; name: string; metadata_uri: string;
};
export type MarketOfferCard = {
  offer_address: string; maker_address: string; nonce: string; kind: 'sale' | 'swap';
  expires_at: string; status: 'active' | 'expired'; can_settle: boolean;
  price_lamports: string; fee_bps: number; fee_lamports: string; seller_lamports: string;
  fee_recipient: string; pet: MarketPetCard; desired_pet: MarketPetCard | null;
};
export type MarketPage = {
  network: SupportedNetwork; program_id: string; collection_address: string; paused: boolean;
  slot: number; chain_time: string; offers: MarketOfferCard[];
  scanned: number; rejected: { offer_address: string; code: string }[];
  next_cursor: string | null; has_more: boolean;
};
const MAX_PAGE = 16;
// Standard getProgramAccounts has no server-side limit. Large catalogues require an
// indexer instead of silently pretending this bounded prototype has full coverage.
const MAX_CATALOGUE = 10_000;
const SYSVAR_OWNER = new PublicKey('Sysvar1111111111111111111111111111111111111');
const ensure = (ok: unknown, code: string, message: string, status = 409): void => {
  if (!ok) throw new ApiError(status, code, message);
};
function readOnlyRpc(rpc: Pick<MarketRpc, 'getGenesisHash' | 'getAccountInfo'>): RpcClient {
  const forbidden = async (): Promise<never> => { throw new Error('MarketReader is read-only.'); };
  return { getGenesisHash: () => rpc.getGenesisHash(), getAccountInfo: (key, commitment) => rpc.getAccountInfo(key, commitment),
    getLatestBlockhash: forbidden, getFeeForMessage: forbidden, simulateTransaction: forbidden,
    getSignatureStatuses: forbidden, getBlockHeight: forbidden };
}

/** Finalized on-chain catalogue. Each page is validated from one bounded bank snapshot. */
export class MarketReader {
  readonly configuration?: MarketConfiguration;
  readonly client?: PixelPetsClient;
  constructor(configuration?: MarketConfiguration) {
    if (!configuration) return;
    ensure(configuration.collectionAddress.length > 0, 'COLLECTION_REQUIRED', '交易市场必须指定官方集合。', 500);
    this.configuration = configuration;
    this.client = new PixelPetsClient({ ...configuration, rpc: readOnlyRpc(configuration.rpc),
      expectedCollection: configuration.collectionAddress, commitment: 'finalized' });
  }
  private configured() {
    ensure(this.configuration && this.client, 'MARKET_DISABLED', '链上交易市场尚未启用。', 503);
    return { configuration: this.configuration!, client: this.client! };
  }
  private async query<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ApiError || error instanceof ChainClientError) throw error;
      throw new ApiError(503, 'MARKET_RPC_UNAVAILABLE', '暂时无法读取链上市场，请稍后重试。');
    }
  }
  async list(input: { limit?: number; cursor?: string } = {}): Promise<MarketPage> {
    const limit = input.limit ?? MAX_PAGE;
    ensure(Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE, 'INVALID_LIMIT', `每页最多读取 ${MAX_PAGE} 条挂单。`, 400);
    const cursor = input.cursor ? publicKey(input.cursor).toBase58() : undefined;
    const { configuration, client } = this.configured();
    await this.query(() => client.assertDeployment());
    const result = await this.query(() => configuration.rpc.getProgramAccounts(client.instructions.programId, {
      commitment: 'finalized', withContext: true,
      filters: [{ dataSize: client.accountCoder.size('Offer') }, { memcmp: client.accountCoder.memcmp('Offer') }],
    }));
    ensure(result.value.length <= MAX_CATALOGUE, 'MARKET_INDEX_REQUIRED', '链上目录超过当前读取上限，需要启用市场索引服务。', 503);
    const rows = [...result.value].sort((a, b) => a.pubkey.toBase58() < b.pubkey.toBase58() ? -1 : a.pubkey.equals(b.pubkey) ? 0 : 1);
    const remaining = cursor ? rows.filter(row => row.pubkey.toBase58() > cursor) : rows;
    const selected = remaining.slice(0, limit);
    const page = await this.snapshot(selected, result.context.slot, false);
    const hasMore = remaining.length > selected.length;
    return { ...page, next_cursor: hasMore ? selected.at(-1)!.pubkey.toBase58() : null, has_more: hasMore };
  }
  /** Expired offers remain inspectable so a maker can prepare a cancellation. */
  async detail(asset: string, nonce: string): Promise<Omit<MarketPage, 'offers' | 'next_cursor' | 'has_more'> & { offer: MarketOfferCard }> {
    const { configuration, client } = this.configured();
    const address = client.pdas.offer(publicKey(asset), integer(nonce))[0];
    await this.query(() => client.assertDeployment());
    const initial = await this.query(() => configuration.rpc.getMultipleAccountsInfoAndContext([address], { commitment: 'finalized' }));
    ensure(initial.value.length === 1, 'INVALID_RPC_RESPONSE', '链上账户响应不完整。', 503);
    ensure(initial.value[0], 'OFFER_NOT_FOUND', '这笔挂单已成交、取消或不存在。', 404);
    const { offers, ...page } = await this.snapshot([{ pubkey: address, account: initial.value[0]! }], initial.context.slot, true);
    ensure(offers.length === 1, page.rejected[0]?.code ?? 'INVALID_OFFER', '这笔挂单当前无法验证，请刷新后重试。');
    return { ...page, offer: offers[0] };
  }
  private decode(address: PublicKey, account: AccountInfo<Buffer>): OfferAccount {
    const { client } = this.configured();
    ensure(account.owner.equals(client.instructions.programId) && !account.executable, 'ACCOUNT_OWNER_MISMATCH', '挂单账户不属于游戏合约。');
    ensure(account.data.length === client.accountCoder.size('Offer'), 'INVALID_OFFER_DATA', '挂单账户长度不正确。');
    const offer = client.accountCoder.decode<OfferAccount>('Offer', account.data);
    const [expected, bump] = client.pdas.offer(offer.asset, offer.nonce);
    ensure(address.equals(expected) && offer.bump === bump, 'PDA_MISMATCH', '挂单地址与资产或编号不符。');
    ensure(offer.kind === 0 || offer.kind === 1, 'INVALID_OFFER_KIND', '未知的挂单类型。');
    ensure(offer.fee_bps <= 500, 'INVALID_FEE', '挂单费用超过合约上限。');
    ensure(!offer.maker.equals(PublicKey.default), 'INVALID_MAKER', '挂单缺少出让人。');
    if (offer.kind === 1) ensure(offer.price_lamports.gtn(0) && offer.desired_asset.equals(PublicKey.default)
      && offer.desired_checkpoint.isZero(), 'INVALID_SALE', '出售挂单的数据不完整。');
    else ensure(offer.price_lamports.isZero() && !offer.desired_asset.equals(PublicKey.default)
      && !offer.desired_asset.equals(offer.asset), 'INVALID_SWAP', '交换挂单的数据不完整。');
    return offer;
  }
  private rejection(error: unknown): string {
    return error instanceof ChainClientError || error instanceof ApiError ? error.code : 'INVALID_OFFER_DATA';
  }
  private async snapshot(rows: GetProgramAccountsResponse, minSlot: number, includeExpired: boolean): Promise<Omit<MarketPage, 'next_cursor' | 'has_more'>> {
    const { configuration, client } = this.configured();
    ensure(Number.isSafeInteger(minSlot) && minSlot >= 0, 'INVALID_RPC_RESPONSE', '链上快照编号无效。', 503);
    const rejected: MarketPage['rejected'] = [];
    const decoded: { pubkey: PublicKey; account: AccountInfo<Buffer>; offer: OfferAccount }[] = [];
    for (const row of rows) {
      try { decoded.push({ ...row, offer: this.decode(row.pubkey, row.account) }); }
      catch (error) { rejected.push({ offer_address: row.pubkey.toBase58(), code: this.rejection(error) }); }
    }
    const addresses = new Map<string, PublicKey>();
    const add = (address: PublicKey) => addresses.set(address.toBase58(), address);
    add(client.pdas.config()[0]); add(publicKey(configuration.collectionAddress)); add(SYSVAR_CLOCK_PUBKEY);
    for (const row of decoded) {
      add(row.pubkey); add(row.offer.asset); add(client.pdas.petRecord(row.offer.asset)[0]);
      if (row.offer.kind === 0) { add(row.offer.desired_asset); add(client.pdas.petRecord(row.offer.desired_asset)[0]); }
    }
    // At most 16 offers * 5 accounts + config + collection + clock = 83.
    const keys = [...addresses.values()];
    ensure(keys.length <= 83, 'MARKET_READ_LIMIT', '市场读取超出当前页面上限。', 500);
    const result = await this.query(() => configuration.rpc.getMultipleAccountsInfoAndContext(keys, { commitment: 'finalized', minContextSlot: minSlot }));
    ensure(Number.isSafeInteger(result.context.slot) && result.context.slot >= minSlot && result.value.length === keys.length,
      'INVALID_RPC_RESPONSE', '链上账户快照过旧或不完整。', 503);
    const accounts = new Map(keys.map((key, index) => [key.toBase58(), result.value[index]]));
    const clock = accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58());
    ensure(clock && clock.owner.equals(SYSVAR_OWNER) && !clock.executable && clock.data.length === 40,
      'CHAIN_CLOCK_UNAVAILABLE', '无法验证链上时间，暂时停止展示可成交挂单。', 503);
    ensure(clock!.data.readBigUInt64LE(0) === BigInt(result.context.slot), 'CHAIN_CLOCK_MISMATCH', '链上时间不属于当前账户快照。', 503);
    const now = clock!.data.readBigInt64LE(32);
    ensure(now > 0n, 'CHAIN_CLOCK_UNAVAILABLE', '链上时间无效。', 503);
    const snapshotClient = new PixelPetsClient({ ...configuration, expectedCollection: configuration.collectionAddress, commitment: 'finalized',
      rpc: readOnlyRpc({ getGenesisHash: async () => client.expectedGenesisHash,
        getAccountInfo: async key => accounts.get(key.toBase58()) ?? null }) });
    // These global failures are never disguised as an empty catalogue.
    const config = await snapshotClient.fetchConfig();
    const offers: MarketOfferCard[] = [];
    for (const row of decoded) {
      try {
        const current = accounts.get(row.pubkey.toBase58());
        ensure(current && current.owner.equals(client.instructions.programId) && current.data.equals(row.account.data),
          'OFFER_CHANGED', '挂单已变更，请刷新。');
        const offer = row.offer;
        const official = await snapshotClient.verifyOfficialPet(offer.asset, row.pubkey);
        ensure(official.record.active_offer.equals(row.pubkey), 'OFFER_INACTIVE', '宠物没有托管在这笔挂单中。');
        ensure(official.record.checkpoint.eq(offer.offered_checkpoint), 'CHECKPOINT_CHANGED', '宠物成长记录已变化。');
        ensure(BigInt(official.record.next_offer_nonce.toString()) === integer(offer.nonce) + 1n,
          'INVALID_NONCE', '挂单编号不属于宠物当前状态。');
        const pet = this.card(official.record, official.coreAsset);
        let desired: MarketPetCard | null = null;
        if (offer.kind === 0) {
          const desiredInfo = accounts.get(offer.desired_asset.toBase58());
          ensure(desiredInfo, 'ACCOUNT_MISSING', '目标宠物已不存在。');
          const [base] = getAssetV1AccountDataSerializer().deserialize(desiredInfo!.data);
          const wanted = await snapshotClient.verifyOfficialPet(offer.desired_asset, base.owner);
          ensure(!publicKey(base.owner).equals(offer.maker), 'SELF_TRADE', '出让人已拥有目标宠物。');
          ensure(wanted.record.active_offer.equals(PublicKey.default), 'DESIRED_PET_LISTED', '目标宠物正在其他挂单中。');
          ensure(wanted.record.checkpoint.eq(offer.desired_checkpoint), 'DESIRED_CHECKPOINT_CHANGED', '目标宠物成长记录已变化。');
          desired = this.card(wanted.record, wanted.coreAsset);
        }
        const expired = integer(offer.expires_at, 64, true) <= now;
        if (expired && !includeExpired) { rejected.push({ offer_address: row.pubkey.toBase58(), code: 'OFFER_EXPIRED' }); continue; }
        // Fees are captured when an offer opens; later config changes do not reprice it.
        const amounts = saleAmounts(offer.price_lamports, offer.fee_bps);
        offers.push({ offer_address: row.pubkey.toBase58(), maker_address: offer.maker.toBase58(), nonce: offer.nonce.toString(),
          kind: offer.kind === 1 ? 'sale' : 'swap', expires_at: offer.expires_at.toString(), status: expired ? 'expired' : 'active',
          can_settle: !expired && !config.paused, price_lamports: amounts.grossLamports, fee_bps: offer.fee_bps,
          fee_lamports: amounts.feeLamports, seller_lamports: amounts.sellerLamports, fee_recipient: offer.fee_recipient.toBase58(),
          pet, desired_pet: desired });
      } catch (error) { rejected.push({ offer_address: row.pubkey.toBase58(), code: this.rejection(error) }); }
    }
    await this.query(() => client.assertNetwork());
    return { network: configuration.network, program_id: client.instructions.programId.toBase58(), collection_address: config.collection.toBase58(),
      paused: config.paused, slot: result.context.slot, chain_time: now.toString(), offers, scanned: rows.length, rejected };
  }
  private card(record: PetRecordAccount, asset: { owner: string; name: string; uri: string }): MarketPetCard {
    const species = ['moss', 'puddle', 'wisp'] as const;
    const forms = ['seed', 'sun', 'moon'] as const;
    ensure(record.species >= 0 && record.species < species.length && record.form >= 0 && record.form < forms.length,
      'INVALID_TRAITS', '宠物品种或形态无效。');
    ensure(Number.isSafeInteger(record.bond) && record.bond >= 0, 'INVALID_TRAITS', '宠物亲密度无效。');
    return { asset_address: record.asset.toBase58(), owner_address: asset.owner, edition_address: record.edition.toBase58(),
      serial: record.serial, species_id: species[record.species], form: forms[record.form], bond: record.bond,
      checkpoint: record.checkpoint.toString(), name: asset.name, metadata_uri: asset.uri };
  }
}
