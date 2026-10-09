#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use mpl_core::{
    accounts::{BaseAssetV1, BaseCollectionV1, PluginHeaderV1, PluginRegistryV1},
    instructions::{CreateCollectionV2CpiBuilder, CreateV2CpiBuilder, TransferV1CpiBuilder},
    types::{AddBlocker, ImmutableMetadata, Key as CoreKey, Plugin, PluginAuthority, PluginAuthorityPair, PluginType, UpdateAuthority},
    DataBlob,
};

declare_id!("2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT");
pub const MAX_FEE_BPS: u16 = 500;
pub const MAX_OFFER_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const MAX_CLAIM_SECONDS: i64 = 15 * 60;

#[program]
pub mod pixel_pets {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        check_metadata(&args.name, &args.uri)?;
        check_config(args.issuer, args.fee_recipient, args.fee_bps)?;
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.issuer = args.issuer;
        config.collection = ctx.accounts.collection.key();
        config.fee_recipient = args.fee_recipient;
        config.fee_bps = args.fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;
        // Only this program can sign as the collection authority. No generic CPI proxy exists.
        CreateCollectionV2CpiBuilder::new(&ctx.accounts.core_program.to_account_info())
            .collection(&ctx.accounts.collection.to_account_info())
            .update_authority(Some(&config.to_account_info()))
            .payer(&ctx.accounts.admin.to_account_info())
            .system_program(&ctx.accounts.system_program.to_account_info())
            .name(args.name).uri(args.uri).invoke()?;
        Ok(())
    }

    pub fn configure(ctx: Context<Configure>, issuer: Pubkey, fee_recipient: Pubkey, fee_bps: u16, paused: bool) -> Result<()> {
        check_config(issuer, fee_recipient, fee_bps)?;
        let config = &mut ctx.accounts.config;
        config.issuer = issuer;
        config.fee_recipient = fee_recipient;
        config.fee_bps = fee_bps;
        config.paused = paused;
        Ok(())
    }

    // Editions are frozen at creation; there is intentionally no supply or metadata update.
    pub fn create_edition(ctx: Context<CreateEdition>, args: EditionArgs) -> Result<()> {
        require!(!ctx.accounts.config.paused, PetError::Paused);
        check_metadata(&args.name, &args.uri)?;
        require!(args.max_supply > 0, PetError::InvalidSupply);
        require!(args.species <= 2 && args.rules_version > 0 && args.origin_hash != [0; 32], PetError::InvalidTraits);
        let edition = &mut ctx.accounts.edition;
        edition.edition_id = args.edition_id;
        edition.max_supply = args.max_supply;
        edition.issued = 0;
        edition.origin_hash = args.origin_hash;
        edition.rules_version = args.rules_version;
        edition.species = args.species;
        edition.name = args.name;
        edition.uri = args.uri;
        edition.bump = ctx.bumps.edition;
        Ok(())
    }

    pub fn claim_pet(ctx: Context<ClaimPet>, claim_id: [u8; 32], expires_at: i64) -> Result<()> {
        require!(!ctx.accounts.config.paused, PetError::Paused);
        let clock = Clock::get()?;
        check_expiry(clock.unix_timestamp, expires_at, MAX_CLAIM_SECONDS)?;
        require!(claim_id != [0; 32], PetError::InvalidClaim);
        check_collection(&ctx.accounts.collection, &ctx.accounts.config)?;
        let edition = &mut ctx.accounts.edition;
        let serial = next_serial(edition.issued, edition.max_supply)?;
        let config_bump = [ctx.accounts.config.bump];
        let seeds: &[&[u8]] = &[b"config", &config_bump];
        CreateV2CpiBuilder::new(&ctx.accounts.core_program.to_account_info())
            .asset(&ctx.accounts.asset.to_account_info())
            .collection(Some(&ctx.accounts.collection.to_account_info()))
            .authority(Some(&ctx.accounts.config.to_account_info()))
            .payer(&ctx.accounts.payer.to_account_info())
            .owner(Some(&ctx.accounts.recipient.to_account_info()))
            .system_program(&ctx.accounts.system_program.to_account_info())
            .name(edition.name.clone()).uri(edition.uri.clone())
            .plugins(locked_plugins()).invoke_signed(&[seeds])?;
        edition.issued = serial;
        let record = &mut ctx.accounts.pet_record;
        record.asset = ctx.accounts.asset.key();
        record.edition = edition.key();
        record.serial = serial;
        record.origin_hash = edition.origin_hash;
        record.species = edition.species;
        record.rules_version = edition.rules_version;
        record.form = 0;
        record.checkpoint = 0;
        record.bond = 0;
        record.event_hash = [0; 32];
        record.checkpoint_slot = clock.slot;
        record.active_offer = Pubkey::default();
        record.next_offer_nonce = 0;
        record.bump = ctx.bumps.pet_record;
        let receipt = &mut ctx.accounts.receipt;
        receipt.claim_id = claim_id;
        receipt.recipient = ctx.accounts.recipient.key();
        receipt.asset = record.asset;
        receipt.edition = edition.key();
        receipt.origin_hash = edition.origin_hash;
        receipt.rules_version = edition.rules_version;
        receipt.expires_at = expires_at;
        receipt.bump = ctx.bumps.receipt;
        emit!(PetClaimed { asset: record.asset, recipient: receipt.recipient, edition: edition.key(), serial });
        Ok(())
    }

    pub fn checkpoint(ctx: Context<Checkpoint>, args: CheckpointArgs) -> Result<()> {
        require!(!ctx.accounts.config.paused, PetError::Paused);
        check_collection(&ctx.accounts.collection, &ctx.accounts.config)?;
        check_pet(&ctx.accounts.asset, &ctx.accounts.pet_record, ctx.accounts.collection.key(), ctx.accounts.owner.key())?;
        let record = &mut ctx.accounts.pet_record;
        require!(record.active_offer == Pubkey::default(), PetError::AlreadyListed);
        check_checkpoint(record, &args)?;
        record.form = args.form;
        record.bond = args.bond;
        record.event_hash = args.event_hash;
        record.checkpoint = record.checkpoint.checked_add(1).ok_or(PetError::Overflow)?;
        record.checkpoint_slot = Clock::get()?.slot;
        emit!(CheckpointRecorded { asset: record.asset, checkpoint: record.checkpoint, form: record.form });
        Ok(())
    }

    pub fn create_swap(ctx: Context<CreateSwap>, nonce: u64, expires_at: i64) -> Result<()> {
        require!(!ctx.accounts.config.paused, PetError::Paused);
        check_collection(&ctx.accounts.collection, &ctx.accounts.config)?;
        check_pet(&ctx.accounts.asset, &ctx.accounts.pet_record, ctx.accounts.collection.key(), ctx.accounts.maker.key())?;
        check_pet_identity(&ctx.accounts.desired_asset, &ctx.accounts.desired_record, ctx.accounts.collection.key())?;
        require_keys_neq!(ctx.accounts.asset.key(), ctx.accounts.desired_asset.key(), PetError::SelfTrade);
        require_keys_neq!(ctx.accounts.desired_asset.owner, ctx.accounts.maker.key(), PetError::SelfTrade);
        require!(ctx.accounts.desired_record.active_offer == Pubkey::default(), PetError::AlreadyListed);
        open_offer(&mut ctx.accounts.offer, &mut ctx.accounts.pet_record, &ctx.accounts.config,
            ctx.accounts.maker.key(), nonce, expires_at, ctx.bumps.offer,
            0, ctx.accounts.desired_asset.key(), ctx.accounts.desired_record.checkpoint, 0)?;
        core_transfer(&ctx.accounts.core_program, &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(), &ctx.accounts.maker.to_account_info(),
            &ctx.accounts.maker.to_account_info(), &ctx.accounts.offer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(), &[])?;
        emit!(OfferOpened { offer: ctx.accounts.offer.key(), asset: ctx.accounts.asset.key(), maker: ctx.accounts.maker.key(), kind: 0 });
        Ok(())
    }

    pub fn create_sale(ctx: Context<CreateSale>, nonce: u64, expires_at: i64, price_lamports: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, PetError::Paused);
        require!(price_lamports > 0, PetError::InvalidPrice);
        check_collection(&ctx.accounts.collection, &ctx.accounts.config)?;
        check_pet(&ctx.accounts.asset, &ctx.accounts.pet_record, ctx.accounts.collection.key(), ctx.accounts.maker.key())?;
        open_offer(&mut ctx.accounts.offer, &mut ctx.accounts.pet_record, &ctx.accounts.config,
            ctx.accounts.maker.key(), nonce, expires_at, ctx.bumps.offer,
            1, Pubkey::default(), 0, price_lamports)?;
        core_transfer(&ctx.accounts.core_program, &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(), &ctx.accounts.maker.to_account_info(),
            &ctx.accounts.maker.to_account_info(), &ctx.accounts.offer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(), &[])?;
        emit!(OfferOpened { offer: ctx.accounts.offer.key(), asset: ctx.accounts.asset.key(), maker: ctx.accounts.maker.key(), kind: 1 });
        Ok(())
    }

    pub fn accept_swap(ctx: Context<AcceptSwap>) -> Result<()> {
        require!(!ctx.accounts.config.paused, PetError::Paused);
        check_collection(&ctx.accounts.collection, &ctx.accounts.config)?;
        let offer = &ctx.accounts.offer;
        check_open_offer(offer, &ctx.accounts.pet_record, ctx.accounts.taker.key(), 0, Clock::get()?.unix_timestamp)?;
        check_pet(&ctx.accounts.asset, &ctx.accounts.pet_record, ctx.accounts.collection.key(), offer.key())?;
        check_pet(&ctx.accounts.desired_asset, &ctx.accounts.desired_record, ctx.accounts.collection.key(), ctx.accounts.taker.key())?;
        require!(ctx.accounts.desired_record.active_offer == Pubkey::default(), PetError::AlreadyListed);
        require!(ctx.accounts.desired_record.checkpoint == offer.desired_checkpoint, PetError::CheckpointChanged);
        // Both transfers are in ONE instruction. A failed second CPI rolls back the first.
        core_transfer(&ctx.accounts.core_program, &ctx.accounts.desired_asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(), &ctx.accounts.taker.to_account_info(),
            &ctx.accounts.taker.to_account_info(), &ctx.accounts.maker.to_account_info(),
            &ctx.accounts.system_program.to_account_info(), &[])?;
        let nonce = offer.nonce.to_le_bytes(); let bump = [offer.bump];
        let seeds: &[&[u8]] = &[b"offer", offer.asset.as_ref(), &nonce, &bump];
        core_transfer(&ctx.accounts.core_program, &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(), &ctx.accounts.taker.to_account_info(),
            &offer.to_account_info(), &ctx.accounts.taker.to_account_info(),
            &ctx.accounts.system_program.to_account_info(), &[seeds])?;
        ctx.accounts.pet_record.active_offer = Pubkey::default();
        emit!(OfferSettled { offer: offer.key(), taker: ctx.accounts.taker.key(), kind: 0 });
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, expected_price_lamports: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, PetError::Paused);
        check_collection(&ctx.accounts.collection, &ctx.accounts.config)?;
        let offer = &ctx.accounts.offer;
        check_open_offer(offer, &ctx.accounts.pet_record, ctx.accounts.buyer.key(), 1, Clock::get()?.unix_timestamp)?;
        require!(offer.price_lamports == expected_price_lamports, PetError::InvalidPrice);
        check_pet(&ctx.accounts.asset, &ctx.accounts.pet_record, ctx.accounts.collection.key(), offer.key())?;
        let fee = fee_amount(offer.price_lamports, offer.fee_bps)?;
        let seller_amount = offer.price_lamports.checked_sub(fee).ok_or(PetError::Overflow)?;
        transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer {
            from: ctx.accounts.buyer.to_account_info(), to: ctx.accounts.maker.to_account_info(),
        }), seller_amount)?;
        if fee > 0 {
            transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer {
                from: ctx.accounts.buyer.to_account_info(), to: ctx.accounts.fee_recipient.to_account_info(),
            }), fee)?;
        }
        let nonce = offer.nonce.to_le_bytes(); let bump = [offer.bump];
        let seeds: &[&[u8]] = &[b"offer", offer.asset.as_ref(), &nonce, &bump];
        core_transfer(&ctx.accounts.core_program, &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(), &ctx.accounts.buyer.to_account_info(),
            &offer.to_account_info(), &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(), &[seeds])?;
        ctx.accounts.pet_record.active_offer = Pubkey::default();
        emit!(OfferSettled { offer: offer.key(), taker: ctx.accounts.buyer.key(), kind: 1 });
        Ok(())
    }

    // Pausing blocks entry/settlement, never return of an escrowed pet. Anyone can return expired offers.
    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        require!(can_cancel(ctx.accounts.caller.key(), offer.maker, Clock::get()?.unix_timestamp, offer.expires_at), PetError::Unauthorized);
        require!(ctx.accounts.pet_record.active_offer == offer.key(), PetError::InvalidOffer);
        // No global plugin-policy check on withdrawal: avoid trapping an existing escrow after policy changes.
        require!(ctx.accounts.asset.key == CoreKey::AssetV1, PetError::InvalidAsset);
        require_keys_eq!(ctx.accounts.asset.owner, offer.key(), PetError::WrongOwner);
        require!(ctx.accounts.asset.update_authority == UpdateAuthority::Collection(ctx.accounts.collection.key()), PetError::InvalidCollection);
        let nonce = offer.nonce.to_le_bytes(); let bump = [offer.bump];
        let seeds: &[&[u8]] = &[b"offer", offer.asset.as_ref(), &nonce, &bump];
        core_transfer(&ctx.accounts.core_program, &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(), &ctx.accounts.caller.to_account_info(),
            &offer.to_account_info(), &ctx.accounts.maker.to_account_info(),
            &ctx.accounts.system_program.to_account_info(), &[seeds])?;
        ctx.accounts.pet_record.active_offer = Pubkey::default();
        emit!(OfferCancelled { offer: offer.key(), maker: offer.maker });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs { pub name: String, pub uri: String, pub issuer: Pubkey, pub fee_recipient: Pubkey, pub fee_bps: u16 }
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EditionArgs { pub edition_id: u64, pub max_supply: u32, pub origin_hash: [u8; 32], pub rules_version: u16, pub species: u8, pub name: String, pub uri: String }
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CheckpointArgs { pub expected_checkpoint: u64, pub form: u8, pub bond: u32, pub event_hash: [u8; 32] }

#[account]
#[derive(InitSpace)]
pub struct Config { pub admin: Pubkey, pub issuer: Pubkey, pub collection: Pubkey, pub fee_recipient: Pubkey, pub fee_bps: u16, pub paused: bool, pub bump: u8 }
#[account]
#[derive(InitSpace)]
pub struct Edition { pub edition_id: u64, pub max_supply: u32, pub issued: u32, pub origin_hash: [u8; 32], pub rules_version: u16, pub species: u8, #[max_len(32)] pub name: String, #[max_len(200)] pub uri: String, pub bump: u8 }
#[account]
#[derive(InitSpace)]
pub struct PetRecord { pub asset: Pubkey, pub edition: Pubkey, pub serial: u32, pub origin_hash: [u8; 32], pub rules_version: u16, pub species: u8, pub form: u8, pub checkpoint: u64, pub bond: u32, pub event_hash: [u8; 32], pub checkpoint_slot: u64, pub active_offer: Pubkey, pub next_offer_nonce: u64, pub bump: u8 }
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt { pub claim_id: [u8; 32], pub recipient: Pubkey, pub asset: Pubkey, pub edition: Pubkey, pub origin_hash: [u8; 32], pub rules_version: u16, pub expires_at: i64, pub bump: u8 }
#[account]
#[derive(InitSpace)]
pub struct Offer { pub maker: Pubkey, pub asset: Pubkey, pub desired_asset: Pubkey, pub fee_recipient: Pubkey, pub nonce: u64, pub expires_at: i64, pub offered_checkpoint: u64, pub desired_checkpoint: u64, pub price_lamports: u64, pub fee_bps: u16, pub kind: u8, pub bump: u8 }

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)] pub config: Account<'info, Config>,
    #[account(mut)] pub collection: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ PetError::Unauthorized)]
    pub program: Program<'info, crate::program::PixelPets>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ PetError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: Core ID and executable are checked; all CPIs target only this program.
    #[account(address = mpl_core::ID, executable)] pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Configure<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)] pub config: Account<'info, Config>,
}
#[derive(Accounts)]
#[instruction(args: EditionArgs)]
pub struct CreateEdition<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin)] pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Edition::INIT_SPACE, seeds = [b"edition".as_ref(), args.edition_id.to_le_bytes().as_ref()], bump)] pub edition: Account<'info, Edition>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct ClaimPet<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    pub recipient: Signer<'info>,
    pub issuer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = issuer, has_one = collection)] pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"edition", &edition.edition_id.to_le_bytes()], bump = edition.bump)] pub edition: Account<'info, Edition>,
    #[account(mut)] pub collection: Account<'info, BaseCollectionV1>,
    #[account(mut)] pub asset: Signer<'info>,
    #[account(init, payer = payer, space = 8 + PetRecord::INIT_SPACE, seeds = [b"pet", asset.key().as_ref()], bump)] pub pet_record: Account<'info, PetRecord>,
    #[account(init, payer = payer, space = 8 + ClaimReceipt::INIT_SPACE, seeds = [b"claim", claim_id.as_ref()], bump)] pub receipt: Account<'info, ClaimReceipt>,
    /// CHECK: Fixed executable Core program.
    #[account(address = mpl_core::ID, executable)] pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Checkpoint<'info> {
    pub owner: Signer<'info>,
    pub issuer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = issuer, has_one = collection)] pub config: Account<'info, Config>,
    pub collection: Account<'info, BaseCollectionV1>,
    pub asset: Account<'info, BaseAssetV1>,
    #[account(mut, seeds = [b"pet", asset.key().as_ref()], bump = pet_record.bump, has_one = asset)] pub pet_record: Account<'info, PetRecord>,
}
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateSale<'info> {
    #[account(mut)] pub maker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = collection)] pub config: Account<'info, Config>,
    pub collection: Account<'info, BaseCollectionV1>,
    #[account(mut)] pub asset: Account<'info, BaseAssetV1>,
    #[account(mut, seeds = [b"pet", asset.key().as_ref()], bump = pet_record.bump, has_one = asset)] pub pet_record: Account<'info, PetRecord>,
    #[account(init, payer = maker, space = 8 + Offer::INIT_SPACE, seeds = [b"offer", asset.key().as_ref(), &nonce.to_le_bytes()], bump)] pub offer: Account<'info, Offer>,
    /// CHECK: Fixed executable Core program.
    #[account(address = mpl_core::ID, executable)] pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateSwap<'info> {
    #[account(mut)] pub maker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = collection)] pub config: Account<'info, Config>,
    pub collection: Account<'info, BaseCollectionV1>,
    #[account(mut)] pub asset: Account<'info, BaseAssetV1>,
    #[account(mut, seeds = [b"pet", asset.key().as_ref()], bump = pet_record.bump, has_one = asset)] pub pet_record: Account<'info, PetRecord>,
    pub desired_asset: Account<'info, BaseAssetV1>,
    #[account(seeds = [b"pet", desired_asset.key().as_ref()], bump = desired_record.bump, constraint = desired_record.asset == desired_asset.key() @ PetError::InvalidAsset)] pub desired_record: Account<'info, PetRecord>,
    #[account(init, payer = maker, space = 8 + Offer::INIT_SPACE, seeds = [b"offer", asset.key().as_ref(), &nonce.to_le_bytes()], bump)] pub offer: Account<'info, Offer>,
    /// CHECK: Fixed executable Core program.
    #[account(address = mpl_core::ID, executable)] pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct AcceptSwap<'info> {
    #[account(mut)] pub taker: Signer<'info>,
    /// CHECK: Fixed offer maker, only receives pet and account rent.
    #[account(mut, address = offer.maker)] pub maker: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = collection)] pub config: Account<'info, Config>,
    pub collection: Account<'info, BaseCollectionV1>,
    #[account(mut, address = offer.asset)] pub asset: Account<'info, BaseAssetV1>,
    #[account(mut, seeds = [b"pet", asset.key().as_ref()], bump = pet_record.bump, has_one = asset)] pub pet_record: Account<'info, PetRecord>,
    #[account(mut, address = offer.desired_asset)] pub desired_asset: Account<'info, BaseAssetV1>,
    #[account(seeds = [b"pet", desired_asset.key().as_ref()], bump = desired_record.bump, constraint = desired_record.asset == desired_asset.key() @ PetError::InvalidAsset)] pub desired_record: Account<'info, PetRecord>,
    #[account(mut, close = maker, seeds = [b"offer", offer.asset.as_ref(), &offer.nonce.to_le_bytes()], bump = offer.bump)] pub offer: Account<'info, Offer>,
    /// CHECK: Fixed executable Core program.
    #[account(address = mpl_core::ID, executable)] pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)] pub buyer: Signer<'info>,
    /// CHECK: Fixed offer maker; receives SOL and account rent only.
    #[account(mut, address = offer.maker)] pub maker: UncheckedAccount<'info>,
    /// CHECK: Fee destination fixed at listing creation, not caller input.
    #[account(mut, address = offer.fee_recipient)] pub fee_recipient: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = collection)] pub config: Account<'info, Config>,
    pub collection: Account<'info, BaseCollectionV1>,
    #[account(mut, address = offer.asset)] pub asset: Account<'info, BaseAssetV1>,
    #[account(mut, seeds = [b"pet", asset.key().as_ref()], bump = pet_record.bump, has_one = asset)] pub pet_record: Account<'info, PetRecord>,
    #[account(mut, close = maker, seeds = [b"offer", offer.asset.as_ref(), &offer.nonce.to_le_bytes()], bump = offer.bump)] pub offer: Account<'info, Offer>,
    /// CHECK: Fixed executable Core program.
    #[account(address = mpl_core::ID, executable)] pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(mut)] pub caller: Signer<'info>,
    /// CHECK: Fixed offer maker; cancellation can never change this recipient.
    #[account(mut, address = offer.maker)] pub maker: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = collection)] pub config: Account<'info, Config>,
    pub collection: Account<'info, BaseCollectionV1>,
    #[account(mut, address = offer.asset)] pub asset: Account<'info, BaseAssetV1>,
    #[account(mut, seeds = [b"pet", asset.key().as_ref()], bump = pet_record.bump, has_one = asset)] pub pet_record: Account<'info, PetRecord>,
    #[account(mut, close = maker, seeds = [b"offer", offer.asset.as_ref(), &offer.nonce.to_le_bytes()], bump = offer.bump)] pub offer: Account<'info, Offer>,
    /// CHECK: Fixed executable Core program.
    #[account(address = mpl_core::ID, executable)] pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn locked_plugins() -> Vec<PluginAuthorityPair> {
    vec![
        PluginAuthorityPair { plugin: Plugin::ImmutableMetadata(ImmutableMetadata {}), authority: Some(PluginAuthority::None) },
        PluginAuthorityPair { plugin: Plugin::AddBlocker(AddBlocker {}), authority: Some(PluginAuthority::None) },
    ]
}
fn check_metadata(name: &str, uri: &str) -> Result<()> {
    require!(!name.trim().is_empty() && name.len() <= 32, PetError::InvalidMetadata);
    require!(uri.len() <= 200 && (uri.starts_with("ipfs://") || uri.starts_with("ar://")) && uri.len() > 8, PetError::InvalidMetadata);
    Ok(())
}
fn check_config(issuer: Pubkey, recipient: Pubkey, fee_bps: u16) -> Result<()> {
    require!(issuer != Pubkey::default() && recipient != Pubkey::default() && fee_bps <= MAX_FEE_BPS, PetError::InvalidConfig);
    Ok(())
}
fn check_expiry(now: i64, expiry: i64, max_duration: i64) -> Result<()> {
    require!(expiry > now && expiry <= now.checked_add(max_duration).ok_or(PetError::Overflow)?, PetError::InvalidExpiry);
    Ok(())
}
fn next_serial(issued: u32, cap: u32) -> Result<u32> {
    require!(issued < cap, PetError::SoldOut);
    issued.checked_add(1).ok_or_else(|| error!(PetError::Overflow))
}
fn fee_amount(price: u64, bps: u16) -> Result<u64> {
    require!(bps <= MAX_FEE_BPS, PetError::InvalidConfig);
    Ok(((price as u128 * bps as u128) / 10_000) as u64)
}
fn can_cancel(caller: Pubkey, maker: Pubkey, now: i64, expiry: i64) -> bool { caller == maker || now >= expiry }
fn check_checkpoint(record: &PetRecord, args: &CheckpointArgs) -> Result<()> {
    require!(args.expected_checkpoint == record.checkpoint, PetError::CheckpointChanged);
    require!(args.form <= 2 && (record.form == 0 || args.form == record.form), PetError::InvalidTraits);
    require!(args.bond >= record.bond && (args.form == 0 || args.bond >= 6), PetError::InvalidTraits);
    require!(args.event_hash != [0; 32] && args.event_hash != record.event_hash, PetError::InvalidClaim);
    Ok(())
}
fn read_registry(data: &[u8], base_len: usize) -> Result<Option<PluginRegistryV1>> {
    if data.len() == base_len { return Ok(None); }
    let header = PluginHeaderV1::from_bytes(data.get(base_len..).ok_or(PetError::InvalidPlugins)?)
        .map_err(|_| error!(PetError::InvalidPlugins))?;
    require!(header.key == CoreKey::PluginHeaderV1, PetError::InvalidPlugins);
    let offset = usize::try_from(header.plugin_registry_offset).map_err(|_| error!(PetError::InvalidPlugins))?;
    require!(offset >= base_len + PluginHeaderV1::LEN, PetError::InvalidPlugins);
    let registry = PluginRegistryV1::from_bytes(data.get(offset..).ok_or(PetError::InvalidPlugins)?)
        .map_err(|_| error!(PetError::InvalidPlugins))?;
    require!(registry.key == CoreKey::PluginRegistryV1 && registry.external_registry.is_empty(), PetError::InvalidPlugins);
    Ok(Some(registry))
}
fn check_collection(collection: &Account<BaseCollectionV1>, config: &Account<Config>) -> Result<()> {
    require!(collection.key == CoreKey::CollectionV1, PetError::InvalidCollection);
    require_keys_eq!(collection.update_authority, config.key(), PetError::InvalidCollection);
    require_keys_eq!(collection.key(), config.collection, PetError::InvalidCollection);
    if let Some(registry) = read_registry(&collection.to_account_info().try_borrow_data()?, collection.len())? {
        require!(registry.registry.is_empty(), PetError::InvalidPlugins);
    }
    Ok(())
}
fn check_pet_identity(asset: &Account<BaseAssetV1>, record: &Account<PetRecord>, collection: Pubkey) -> Result<()> {
    require!(asset.key == CoreKey::AssetV1, PetError::InvalidAsset);
    require_keys_eq!(asset.key(), record.asset, PetError::InvalidAsset);
    require!(asset.update_authority == UpdateAuthority::Collection(collection), PetError::InvalidCollection);
    let info = asset.to_account_info(); let data = info.try_borrow_data()?;
    let registry = read_registry(&data, asset.len())?.ok_or(PetError::InvalidPlugins)?;
    require!(registry.registry.len() == 2, PetError::InvalidPlugins);
    for kind in [PluginType::ImmutableMetadata, PluginType::AddBlocker] {
        require!(registry.registry.iter().filter(|r| r.plugin_type == kind && r.authority == PluginAuthority::None).count() == 1, PetError::InvalidPlugins);
    }
    Ok(())
}
fn check_pet(asset: &Account<BaseAssetV1>, record: &Account<PetRecord>, collection: Pubkey, expected_owner: Pubkey) -> Result<()> {
    check_pet_identity(asset, record, collection)?;
    require_keys_eq!(asset.owner, expected_owner, PetError::WrongOwner);
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn open_offer(offer: &mut Account<Offer>, record: &mut Account<PetRecord>, config: &Config,
    maker: Pubkey, nonce: u64, expires_at: i64, bump: u8, kind: u8, desired: Pubkey, desired_checkpoint: u64, price: u64) -> Result<()> {
    require!(record.active_offer == Pubkey::default(), PetError::AlreadyListed);
    require!(nonce == record.next_offer_nonce, PetError::InvalidNonce);
    check_expiry(Clock::get()?.unix_timestamp, expires_at, MAX_OFFER_SECONDS)?;
    offer.maker = maker; offer.asset = record.asset; offer.desired_asset = desired;
    offer.fee_recipient = config.fee_recipient; offer.nonce = nonce; offer.expires_at = expires_at;
    offer.offered_checkpoint = record.checkpoint; offer.desired_checkpoint = desired_checkpoint;
    offer.price_lamports = price; offer.fee_bps = config.fee_bps; offer.kind = kind; offer.bump = bump;
    record.active_offer = offer.key();
    record.next_offer_nonce = nonce.checked_add(1).ok_or(PetError::Overflow)?;
    Ok(())
}
fn check_open_offer(offer: &Account<Offer>, record: &PetRecord, taker: Pubkey, kind: u8, now: i64) -> Result<()> {
    require!(offer.kind == kind && record.active_offer == offer.key(), PetError::InvalidOffer);
    require!(now < offer.expires_at, PetError::OfferExpired);
    require!(record.checkpoint == offer.offered_checkpoint, PetError::CheckpointChanged);
    require_keys_neq!(offer.maker, taker, PetError::SelfTrade);
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn core_transfer<'info>(program: &UncheckedAccount<'info>, asset: &AccountInfo<'info>, collection: &AccountInfo<'info>,
    payer: &AccountInfo<'info>, authority: &AccountInfo<'info>, new_owner: &AccountInfo<'info>, system: &AccountInfo<'info>, seeds: &[&[&[u8]]]) -> Result<()> {
    TransferV1CpiBuilder::new(&program.to_account_info()).asset(asset).collection(Some(collection)).payer(payer)
        .authority(Some(authority)).new_owner(new_owner).system_program(Some(system)).invoke_signed(seeds)?;
    Ok(())
}

#[event] pub struct PetClaimed { pub asset: Pubkey, pub recipient: Pubkey, pub edition: Pubkey, pub serial: u32 }
#[event] pub struct CheckpointRecorded { pub asset: Pubkey, pub checkpoint: u64, pub form: u8 }
#[event] pub struct OfferOpened { pub offer: Pubkey, pub asset: Pubkey, pub maker: Pubkey, pub kind: u8 }
#[event] pub struct OfferSettled { pub offer: Pubkey, pub taker: Pubkey, pub kind: u8 }
#[event] pub struct OfferCancelled { pub offer: Pubkey, pub maker: Pubkey }

#[error_code]
pub enum PetError {
    #[msg("Protocol is paused; cancellation remains available")] Paused,
    #[msg("Signer is not authorized")] Unauthorized,
    #[msg("Metadata must have a nonempty short name and content-addressed URI")] InvalidMetadata,
    #[msg("Invalid config or fee exceeds 5 percent")] InvalidConfig,
    #[msg("Invalid edition supply")] InvalidSupply,
    #[msg("Invalid species, growth transition, bond or rules version")] InvalidTraits,
    #[msg("Invalid claim or event hash")] InvalidClaim,
    #[msg("Claim or offer expiration is outside the allowed window")] InvalidExpiry,
    #[msg("Edition supply is exhausted")] SoldOut,
    #[msg("Arithmetic overflow")] Overflow,
    #[msg("Wrong canonical collection or update authority")] InvalidCollection,
    #[msg("Invalid official asset identity")] InvalidAsset,
    #[msg("Unsupported plugin, external adapter, or mutable plugin authority")] InvalidPlugins,
    #[msg("Wallet is not the current Core asset owner")] WrongOwner,
    #[msg("Pet is already in escrow")] AlreadyListed,
    #[msg("Checkpoint changed; refresh the quote")] CheckpointChanged,
    #[msg("Offer nonce is stale")] InvalidNonce,
    #[msg("Offer is not the active matching offer")] InvalidOffer,
    #[msg("Offer expired")] OfferExpired,
    #[msg("Cannot trade with yourself")] SelfTrade,
    #[msg("Price must match and be greater than zero")] InvalidPrice,
}

#[cfg(test)] mod tests;
