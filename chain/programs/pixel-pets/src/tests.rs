use super::*;
use anchor_lang::Discriminator;
use mpl_core::types::RegistryRecord;

fn pet() -> PetRecord {
    PetRecord { asset: Pubkey::new_unique(), edition: Pubkey::new_unique(), serial: 1,
        origin_hash: [1; 32], rules_version: 1, species: 0, form: 0, checkpoint: 0,
        bond: 0, event_hash: [0; 32], checkpoint_slot: 1, active_offer: Pubkey::default(),
        next_offer_nonce: 0, bump: 255 }
}
fn args() -> CheckpointArgs {
    CheckpointArgs { expected_checkpoint: 0, form: 1, bond: 6, event_hash: [2; 32] }
}
fn registry_bytes(registry: PluginRegistryV1) -> Vec<u8> {
    let mut data = vec![0; 8];
    data.extend(PluginHeaderV1 { key: CoreKey::PluginHeaderV1, plugin_registry_offset: 17 }.try_to_vec().unwrap());
    data.extend(registry.try_to_vec().unwrap());
    data
}

#[test]
fn cap_cannot_overflow_or_reopen_at_maximum() {
    assert_eq!(next_serial(0, 1).unwrap(), 1);
    assert!(next_serial(1, 1).is_err());
    assert!(next_serial(0, 0).is_err());
    assert_eq!(next_serial(u32::MAX - 1, u32::MAX).unwrap(), u32::MAX);
    assert!(next_serial(u32::MAX, u32::MAX).is_err());
}
#[test]
fn fee_handles_u64_max_without_overflow_and_never_exceeds_price() {
    for price in [0, 1, 99, 20_000, u64::MAX] {
        for bps in [0, 1, 250, 500] {
            let fee = fee_amount(price, bps).unwrap();
            assert_eq!(fee as u128, (price as u128 * bps as u128) / 10_000);
            assert!(fee <= price);
        }
    }
    assert!(fee_amount(100, 501).is_err());
}
#[test]
fn signer_configuration_rejects_zero_and_excess_fee() {
    let key = Pubkey::new_unique();
    assert!(check_config(key, key, 500).is_ok());
    assert!(check_config(Pubkey::default(), key, 0).is_err());
    assert!(check_config(key, Pubkey::default(), 0).is_err());
    assert!(check_config(key, key, 501).is_err());
}
#[test]
fn validity_window_rejects_expired_and_unbounded_qualification() {
    assert!(check_expiry(100, 101, MAX_CLAIM_SECONDS).is_ok());
    assert!(check_expiry(100, 100, MAX_CLAIM_SECONDS).is_err());
    assert!(check_expiry(100, 1001, MAX_CLAIM_SECONDS).is_err());
    assert!(check_expiry(i64::MAX, i64::MAX, 900).is_err());
}
#[test]
fn cancellation_always_returns_control_to_maker_and_expiry_allows_keeper() {
    let maker = Pubkey::new_unique(); let attacker = Pubkey::new_unique();
    assert!(can_cancel(maker, maker, 10, 100));
    assert!(!can_cancel(attacker, maker, 99, 100));
    assert!(can_cancel(attacker, maker, 100, 100));
}
#[test]
fn content_metadata_rejects_mutable_http_and_oversized_utf8() {
    assert!(check_metadata("苔苔", "ipfs://bafyOriginalMetadata").is_ok());
    assert!(check_metadata("ghost", "ar://long-transaction-id").is_ok());
    assert!(check_metadata("ghost", "https://example.com/dynamic.json").is_err());
    assert!(check_metadata("", "ipfs://x").is_err());
    assert!(check_metadata(&"苔".repeat(11), "ipfs://bafyOriginalMetadata").is_err());
}
#[test]
fn checkpoint_requires_exact_sequence_and_novel_event() {
    let record = pet(); let mut update = args();
    assert!(check_checkpoint(&record, &update).is_ok());
    update.expected_checkpoint = 1;
    assert!(check_checkpoint(&record, &update).is_err());
    update.expected_checkpoint = 0; update.event_hash = [0; 32];
    assert!(check_checkpoint(&record, &update).is_err());
}
#[test]
fn grown_pet_cannot_switch_branch_or_regress_to_seed() {
    let mut record = pet(); record.form = 1; record.bond = 6;
    let mut update = args(); update.form = 2;
    assert!(check_checkpoint(&record, &update).is_err());
    update.form = 0;
    assert!(check_checkpoint(&record, &update).is_err());
    update.form = 1; update.bond = 5;
    assert!(check_checkpoint(&record, &update).is_err());
    update.bond = 6;
    assert!(check_checkpoint(&record, &update).is_ok());
}
#[test]
fn immature_pet_cannot_publish_grown_form() {
    let record = pet(); let mut update = args(); update.bond = 5;
    assert!(check_checkpoint(&record, &update).is_err());
    update.form = 0;
    assert!(check_checkpoint(&record, &update).is_ok());
    update.form = 3; update.bond = 99;
    assert!(check_checkpoint(&record, &update).is_err());
}
#[test]
fn registry_rejects_out_of_range_offset_and_wrong_account_type() {
    assert!(read_registry(&[0; 8], 8).unwrap().is_none());
    assert!(read_registry(&[0; 9], 8).is_err());
    let mut malformed = vec![0; 8];
    malformed.extend(PluginHeaderV1 { key: CoreKey::PluginHeaderV1, plugin_registry_offset: u64::MAX }.try_to_vec().unwrap());
    assert!(read_registry(&malformed, 8).is_err());
    let wrong = registry_bytes(PluginRegistryV1 { key: CoreKey::AssetV1, registry: vec![], external_registry: vec![] });
    assert!(read_registry(&wrong, 8).is_err());
}
#[test]
fn locked_plugins_have_no_reassignable_authority() {
    let plugins = locked_plugins(); assert_eq!(plugins.len(), 2);
    assert!(plugins.iter().all(|p| p.authority == Some(PluginAuthority::None)));
    let data = registry_bytes(PluginRegistryV1 { key: CoreKey::PluginRegistryV1,
        registry: vec![RegistryRecord { plugin_type: PluginType::ImmutableMetadata, authority: PluginAuthority::None, offset: 17 }],
        external_registry: vec![] });
    assert_eq!(read_registry(&data, 8).unwrap().unwrap().registry.len(), 1);
}
#[test]
fn account_serialization_fits_declared_size() {
    let record = pet(); let mut data = vec![]; record.try_serialize(&mut data).unwrap();
    assert_eq!(data.len(), 8 + PetRecord::INIT_SPACE);
    assert_eq!(&data[..8], PetRecord::DISCRIMINATOR);
    let edition = Edition { edition_id: 1, max_supply: 2, issued: 0, origin_hash: [9; 32], rules_version: 1,
        species: 0, name: "x".repeat(32), uri: "x".repeat(200), bump: 254 };
    data.clear(); edition.try_serialize(&mut data).unwrap();
    assert_eq!(data.len(), 8 + Edition::INIT_SPACE);
}
#[test]
fn claim_pda_is_global_per_program_and_network_must_be_checked_by_client() {
    let claim = [42; 32];
    let (a, _) = Pubkey::find_program_address(&[b"claim", &claim], &crate::ID);
    let (replay, _) = Pubkey::find_program_address(&[b"claim", &claim], &crate::ID);
    let (other_program, _) = Pubkey::find_program_address(&[b"claim", &claim], &Pubkey::new_unique());
    assert_eq!(a, replay); assert_ne!(a, other_program);
}
#[test]
fn sequential_offer_nonces_do_not_reuse_closed_addresses() {
    let asset = Pubkey::new_unique();
    let (first, _) = Pubkey::find_program_address(&[b"offer", asset.as_ref(), &0_u64.to_le_bytes()], &crate::ID);
    let (second, _) = Pubkey::find_program_address(&[b"offer", asset.as_ref(), &1_u64.to_le_bytes()], &crate::ID);
    assert_ne!(first, second);
}
