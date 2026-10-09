extends SceneTree

var failures: Array[String] = []
var checks: int = 0

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		push_error(message)

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	if not "--client-test" in OS.get_cmdline_user_args():
		push_error("Run with -- --client-test so this test never opens a player session.")
		quit(2)
		return
	var scene = load("res://main.tscn")
	var viewport := SubViewport.new()
	viewport.size = Vector2i(360, 640)
	root.add_child(viewport)
	var client = scene.instantiate()
	viewport.add_child(client)
	await process_frame
	await process_frame
	check(client.api.test_mode, "Test cannot call a live service")
	check(client.pets.is_empty(), "An offline visitor has no invented owned pets")
	var first_event: String = client._event_for("pet:feed")
	check(first_event == client._event_for("pet:feed"), "An uncertain retry reuses its idempotency key")
	check(first_event != client._event_for("pet:play"), "Different actions have independent event identities")
	client.online = true
	var pet := {"id": "test-pet", "species_id": "moss", "nickname": "第一次相遇", "form": "seed", "bond": 0, "energy": 80, "mood": 70, "chain": {"status": "unregistered"}}
	client._upsert_pet(pet)
	client.selected_pet = "test-pet"
	var updated: Dictionary = pet.duplicate(true)
	updated["bond"] = 6
	updated["form"] = "moon"
	client._upsert_pet(updated)
	check(client.pets.size() == 1, "A care response replaces the pet and does not duplicate ownership")
	check(client.current_pet()["bond"] == 6, "Care UI reads the server response")
	check(client._form_name(client.current_pet()) == "月影苔苔", "The confirmed moon branch is displayed")
	client.chain_config["market_enabled"] = true
	client.bridge_requests["market-response"] = {"method": "offers", "generation": client.account_generation}
	client._on_bridge([JSON.stringify({"id": "market-response", "ok": true, "data": {"offers": [{"kind": "sale", "price_sol": "9007199.254740993", "fee_sol": "225179.981368524", "can_settle": true, "pet": {"asset_address": "market-pet-address", "species_id": "wisp", "form": "sun", "bond": 6, "checkpoint": "1"}}], "rejected": [], "has_more": false}})])
	check(client.market_page.get("offers", []).size() == 1, "Verified market response creates a quote page")
	check(client.pets.size() == 1 and client.current_pet()["id"] == "test-pet", "Browsing a quote never adds the seller's pet to owned collection")
	for dimensions in [Vector2i(360,640), Vector2i(1000,740)]:
		viewport.size = dimensions
		client.size = Vector2(dimensions)
		await process_frame
		for next_page in ["companion", "collection", "journal", "trade"]:
			client.page = next_page
			client._render()
			await process_frame
			await process_frame
			check(client.content.get_combined_minimum_size().x <= dimensions.x - 36, "%s should fit %d px width; got %f" % [next_page, dimensions.x, client.content.get_combined_minimum_size().x])
			check(client.content.get_child_count() > 0, "%s has visible content" % next_page)
	client.page = "companion"
	client._render()
	client._open_adventure()
	check(is_instance_valid(client.modal), "Adventure choice opens")
	client._start_adventure("moon")
	client._collect_memory()
	client._collect_memory()
	check(client.adventure_count == 2, "Two collectible interactions advance the adventure")
	check(client.current_pet()["bond"] == 6, "Local collectible clicks cannot mutate trusted growth")
	client._close_modal()
	client._on_bridge([JSON.stringify({"id": "wallet_changed", "ok": true, "data": {"connected": true, "address": "wallet-test", "authenticated": true}})])
	check(client.wallet["connected"], "Wallet connection reflects actual bridge messages")
	client._on_bridge([JSON.stringify({"id": "wallet_changed", "ok": true, "data": {"connected": false, "address": ""}})])
	check(not client.wallet["connected"], "Disconnect clears wallet display")
	check(not client.chain_config.get("enabled", true), "Unconfigured chain remains unavailable")
	client.api.save_token("a".repeat(43))
	client.journal = [{"message": "private old profile"}]
	client.pending_actions["old-event"] = "old-event-id"
	client.bridge_requests["old-response"] = {"method": "checkpoint", "generation": client.account_generation}
	client.bridge_requests["recover-response"] = {"method": "recover", "generation": client.account_generation}
	client._on_bridge([JSON.stringify({"id": "recover-response", "ok": true, "data": {
		"recovered": true, "game_token": "b".repeat(43), "connected": true, "authenticated": true, "address": "recovered-wallet"
	}})])
	check(client.api.token == "b".repeat(43), "Verified recovery replaces the active play credential")
	check(client.api.previous_tokens.has("a".repeat(43)), "Recovery preserves the previous visitor locally")
	check(client.pets.is_empty() and client.journal.is_empty() and client.market_page.is_empty(), "Recovery clears every old profile view before loading the new one")
	check(client.pending_actions.is_empty(), "Pending care identities cannot cross between profiles")
	check(not client.wallet.has("game_token"), "The game credential is not kept in wallet display data")
	client._on_bridge([JSON.stringify({"id": "old-response", "ok": true, "data": {"pet": pet}})])
	check(client.pets.is_empty(), "A late response from the previous profile cannot add its pet to the new one")
	client._restore_previous_profile()
	check(client.api.token == "a".repeat(43) and client.api.previous_tokens.has("b".repeat(43)), "Switching back retains both independent local profiles")
	client._on_bridge([JSON.stringify({"id": "unknown-response", "ok": true, "data": {"recovered": true, "game_token": "c".repeat(43)}})])
	check(client.api.token == "a".repeat(43), "Unsolicited recovery data cannot replace a profile")
	client.bridge_requests["invalid-recovery"] = {"method": "recover", "generation": client.account_generation}
	client._on_bridge([JSON.stringify({"id": "invalid-recovery", "ok": true, "data": {"recovered": true, "game_token": "!".repeat(43)}})])
	check(client.api.token == "a".repeat(43) and client.pets.is_empty(), "Failed credential persistence cannot switch the active profile")
	var registered: Dictionary = pet.duplicate(true)
	registered["id"] = "received-pet"
	registered["revision"] = 5
	registered["chain"] = {"status": "registered", "received": true}
	registered["ownership"] = {"status": "owned", "can_interact": true}
	client.pets = [pet]
	client.wallet = {"authenticated": true, "connected": true, "address": "current-wallet"}
	client.busy = true
	client.bridge_requests["sync-response"] = {"method": "sync_assets", "generation": client.account_generation}
	client._on_bridge([JSON.stringify({"id": "sync-response", "ok": true, "data": {"pets": [registered], "ownership": {"unavailable": 0}}})])
	check(client.pets.size() == 1 and client.current_pet()["id"] == "received-pet", "Ownership synchronization replaces the full list and removes outgoing pets")
	check(not client.busy and client._adopted_count() == 0, "Incoming assets unlock the interface and do not consume free adoption slots")
	check(client._pet_access_message(registered).is_empty(), "A verified current wallet can care for its owned registered pet")
	client.wallet = {}
	check(not client._pet_access_message(registered).is_empty(), "Registered care requires wallet authentication")
	client.wallet = {"authenticated": true}
	registered["ownership"] = {"status": "escrow", "can_interact": false}
	check(client._pet_access_message(registered).contains("成交"), "Escrow assets explain why care is unavailable")
	registered["ownership"] = {"status": "unverified", "can_interact": false}
	check(not client._pet_access_message(registered).is_empty(), "Unverified assets remain read only")
	registered["ownership"] = {"status": "owned", "can_interact": true}
	var stale: Dictionary = registered.duplicate(true)
	stale["revision"] = 4
	stale["nickname"] = "stale-name"
	client._upsert_pet(stale)
	check(client.current_pet()["nickname"] != "stale-name", "An old revision cannot undo newer confirmed pet state")
	client.pending_actions["received-pet:feed:"] = "event"
	client.busy = true
	client.bridge_requests["care-response"] = {"method": "care", "generation": client.account_generation, "context": {"key": "received-pet:feed:", "action": "feed"}}
	registered["revision"] = 6
	registered["bond"] = 1
	client._on_bridge([JSON.stringify({"id": "care-response", "ok": true, "data": {"pet": registered, "event": {"message": "care-confirmed", "applied": true}}})])
	check(not client.busy and client.current_pet()["bond"] == 1 and client.pending_actions.is_empty(), "Wallet-authenticated care uses the confirmed response and retires its retry identity")
	client._on_bridge([JSON.stringify({"id": "unknown-pet-response", "ok": true, "data": {"pet": pet}})])
	check(client.pets.size() == 1, "Unsolicited asset responses cannot inject another profile's pets")
	viewport.queue_free()
	await process_frame
	print("PixelPets client: %d checks, %d failures" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
