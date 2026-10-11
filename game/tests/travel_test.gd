extends SceneTree
## Travel UI states rendered from server-shaped data (no live service): planner, away, back, postcard, receipt, keepsakes.

var failures: Array[String] = []
var checks: int = 0

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		push_error(message)

func _initialize() -> void:
	call_deferred("run")

func texts(node: Node, out: PackedStringArray = []) -> PackedStringArray:
	if node is Label or node is Button:
		out.append(node.text)
	for child in node.get_children():
		texts(child, out)
	return out

func has_text(client, needle: String) -> bool:
	for value in texts(client.content):
		if value.contains(needle):
			return true
	return false

func iso(ms: float) -> String:
	return Time.get_datetime_string_from_unix_time(int(ms / 1000.0)) + ".%03dZ" % (int(ms) % 1000)

func run() -> void:
	if not "--client-test" in OS.get_cmdline_user_args():
		push_error("Run with -- --client-test")
		quit(2)
		return
	L10n.lang = "en"
	var viewport := SubViewport.new()
	viewport.size = Vector2i(360, 640)
	root.add_child(viewport)
	var client = load("res://main.tscn").instantiate()
	viewport.add_child(client)
	await process_frame
	client.online = true
	var view: TravelView = client.travel
	check(view != null, "Travel component is created separately from main.gd")
	var pet := {"id": "11111111-2222-3333-4444-555555555555", "species_id": "wisp", "nickname": "W", "form": "seed", "bond": 1, "energy": 70, "mood": 70, "revision": 1, "chain": {"status": "unregistered"}}
	client._upsert_pet(pet)
	client.selected_pet = pet["id"]
	view.catalog = {"demo": {"duration_ms": 45000}, "routes": [
		{"id": "sunny_market", "name": {"en": "Sunny Market", "zh": "阳光集市"}, "blurb": {"en": "Warm stones.", "zh": "暖石"}, "trait": "sun"},
		{"id": "moonlit_lane", "name": {"en": "Moonlit Lantern Lane", "zh": "月灯小径"}, "blurb": {"en": "Lanterns.", "zh": "灯笼"}, "trait": "moon"}],
		"packings": [{"id": "snack_tin", "name": {"en": "Snack tin", "zh": "点心盒"}}, {"id": "tiny_lantern", "name": {"en": "Tiny lantern", "zh": "小提灯"}}],
		"odds": {"tiers": [{"tier": "common", "percent": 60}, {"tier": "repeat", "percent": 25}, {"tier": "special", "percent": 10}, {"tier": "clue", "percent": 5}], "note": "Rewards are drawn by the server."},
		"disclosure": "Keepsakes are in-game collection records, not tokens or NFTs."}
	view.loaded_generation = client.account_generation
	view.supplies = {"balance": 3, "daily_cap": 3}
	view.trips[pet["id"]] = {}
	client.page = "travel"
	client._render()
	await process_frame
	check(has_text(client, "Pack & go"), "Planner shows Pack & go")
	check(has_text(client, "Demo trip · 45 seconds"), "Accelerated demo label is always shown")
	check(has_text(client, "Free supplies: 3 / 3"), "Supplies come from the server ledger")
	check(has_text(client, "Changes the story") or has_text(client, "changes the story"), "Packing is disclosed as story-only")
	view.supplies = {"balance": 0, "daily_cap": 3}
	client._render()
	var go_disabled := false
	for button in client.content.find_children("*", "Button", true, false):
		if button.text == "Pack & go":
			go_disabled = button.disabled
	check(go_disabled, "No supplies disables departure")
	# Server clock is 10 minutes ahead of the device: the countdown must follow the server, not the device.
	var local_now: float = Time.get_unix_time_from_system() * 1000.0
	var server_now: float = local_now + 600000.0
	view._accept({"trip": {"id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "pet_id": pet["id"], "route_id": "moonlit_lane", "state": "travelling",
		"ready_at": iso(server_now + 30000.0), "server_time": iso(server_now), "public_receipt_id": "jr_TESTTESTTESTTESTTESTTE"}, "supplies": {"balance": 2, "daily_cap": 3, "server_time": iso(server_now)}})
	var left: float = view.remaining_ms(view.trips[pet["id"]])
	check(left > 25000.0 and left <= 31000.0, "Countdown uses the server clock offset (got %f ms)" % left)
	client._render()
	check(has_text(client, "On the way to Moonlit Lantern Lane"), "Away state names the destination")
	check(not has_text(client, "Open the postcard"), "Postcard can't open before the server ready time")
	view.trips[pet["id"]]["ready_at"] = iso(server_now - 1000.0)
	client._render()
	check(has_text(client, "Your companion is back") and has_text(client, "Open the postcard"), "Return state appears once the server time passes ready_at")
	var revealed := {"id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "pet_id": pet["id"], "route_id": "moonlit_lane", "state": "revealed", "public_receipt_id": "jr_TESTTESTTESTTESTTESTTE",
		"result": {"tier": "special", "clue": null, "result_hash": "ab".repeat(32), "items": [{"id": "last_lantern", "quantity": 1, "rarity": "special", "name": {"en": "The Last Lantern", "zh": "最后一盏灯"}}],
		"story": {"en": {"title": "A trip to Moonlit Lantern Lane", "lines": ["It watched a meteor."]}, "zh": {"title": "去月灯小径", "lines": ["看了流星。"]}}}, "receipt": null}
	view.trips[pet["id"]] = revealed
	client._render()
	check(has_text(client, "A trip to Moonlit Lantern Lane") and has_text(client, "The Last Lantern"), "Postcard shows story and keepsake")
	check(has_text(client, "Rewards are drawn by the server"), "Postcard carries the server-draw disclosure")
	check(has_text(client, "Claim on Devnet"), "Unclaimed pets are offered Claim on Devnet before saving a receipt")
	check(not has_text(client, "Provably fair") and not has_text(client, "Fully on-chain"), "No forbidden fairness claims")
	pet["chain"] = {"status": "registered"}
	pet["ownership"] = {"status": "owned", "can_interact": true}
	pet["revision"] = 2
	client._upsert_pet(pet)
	client.wallet = {"authenticated": true, "connected": true}
	client.chain_config = {"enabled": true, "network": "solana:devnet"}
	client._render()
	check(has_text(client, "Save journey receipt"), "Registered pet can save a journey receipt")
	revealed["receipt"] = {"status": "prepared", "signature": null}
	client._render()
	check(has_text(client, "Save journey receipt") and not has_text(client, "Submitted"), "An unsigned prepared intent is not shown as submitted")
	revealed["receipt"] = {"status": "submitted", "signature": "5".repeat(88)}
	client._render()
	check(has_text(client, "Submitted · checking confirmation") and has_text(client, "Check confirmation"), "Pending receipts never claim confirmation")
	revealed["receipt"] = {"status": "confirmed", "signature": "5".repeat(88), "finalized_slot": 1}
	client._render()
	check(has_text(client, "Confirmed on Solana Devnet"), "Only a confirmed receipt is labelled Confirmed on Solana Devnet")
	check(has_text(client, "Open public proof"), "Confirmed receipt links its public proof")
	var english: String = " ".join(texts(client.content))
	check(not L10n._has_cjk(english), "English travel screens contain no Chinese text")
	view.collections = {"discovered": 1, "total": 8, "disclosure": "Keepsakes are in-game collection records, not tokens or NFTs.", "collectibles": [
		{"id": "last_lantern", "route": "moonlit_lane", "rarity": "special", "name": {"en": "The Last Lantern"}, "description": {"en": "Given by the vendor."}, "discovered": true, "quantity": 1},
		{"id": "dew_bottle", "route": "moonlit_lane", "rarity": "common", "name": {"en": "Bottle of Dew"}, "description": {"en": "Drops."}, "discovered": false, "quantity": 0}]}
	for dimensions in [Vector2i(360, 640), Vector2i(1000, 740)]:
		viewport.size = dimensions
		client.size = Vector2(dimensions)
		await process_frame
		for next_page in ["travel", "collection"]:
			client.page = next_page
			client._render()
			await process_frame
			await process_frame
			check(client.content.get_combined_minimum_size().x <= dimensions.x - 36, "%s fits %d px (got %f)" % [next_page, dimensions.x, client.content.get_combined_minimum_size().x])
	check(has_text(client, "1 / 8 found") and has_text(client, "The Last Lantern") and has_text(client, "???"), "Keepsakes show found and unknown entries separately from pet cards")
	# P1 gift: rendered only for registered pets; disabled while travelling (Astra §5).
	viewport.size = Vector2i(360, 640)
	client.size = Vector2(360, 640)
	var gift_pet: Dictionary = {"id": "99999999-2222-3333-4444-555555555555", "species_id": "moss", "nickname": "G", "form": "seed", "bond": 1, "energy": 70, "mood": 70, "revision": 1,
		"chain": {"status": "registered", "asset_address": "AssetAssetAssetAssetAssetAssetAsset11111"}, "ownership": {"status": "owned", "can_interact": true}}
	client._upsert_pet(gift_pet)
	client.selected_pet = gift_pet["id"]
	client.chain_config = {"enabled": true, "network": "solana:localnet"}
	client.wallet = {"connected": true, "authenticated": true, "address": "5wpnLLhKxxxxxxxxxxxxxxxxxxxxxxxxxxxxjdow"}
	view.trips[gift_pet["id"]] = {"id": "t1", "state": "travelling"}
	client.page = "trade"
	client._render()
	check(has_text(client, "Send as a gift"), "Registered pet shows Send as a gift")
	check(client.gift_block_reason(gift_pet, true).contains("旅行"), "Gift is blocked while travelling")
	check(has_text(client, "Gifting opens again after it is back"), "Travelling block reason is shown in English")
	var gift_button: Button = null
	for node in client.content.find_children("*", "Button", true, false):
		if node.text == "Send as a gift":
			gift_button = node
	check(gift_button != null and gift_button.disabled, "Gift button is disabled while travelling")
	view.trips[gift_pet["id"]] = {"id": "t1", "state": "revealed"}
	client._render()
	check(client.gift_block_reason(gift_pet, true).is_empty(), "Gift allowed after the trip is back")
	for node in client.content.find_children("*", "Button", true, false):
		if node.text == "Send as a gift":
			gift_button = node
	check(gift_button != null and not gift_button.disabled, "Gift button enabled once back")
	check(not client.gift_block_reason({"id": "x", "chain": {"status": "unregistered"}}, true).is_empty(), "Unregistered pets cannot be gifted")
	var unverified: Dictionary = gift_pet.duplicate(true)
	unverified["ownership"] = {"status": "unverified", "can_interact": false}
	check(not client.gift_block_reason(unverified, true).is_empty(), "Unverified ownership blocks gifting")
	var unchecked: Dictionary = gift_pet.duplicate(true)
	unchecked["id"] = "trip-not-loaded"
	check(not client.gift_block_reason(unchecked, true).is_empty(), "Unknown trip state cannot enable gifting")
	view.loading = true
	check(not client.gift_block_reason(gift_pet, true).is_empty(), "Gifting waits for the trip lookup to finish")
	view.loading = false
	check(not L10n._has_cjk(" ".join(texts(client.content))), "English wallet screen with gift contains no Chinese text")
	L10n.lang = "zh"
	client.page = "travel"
	view.trips[gift_pet["id"]] = {}
	client._render()
	check(has_text(client, "收拾行囊去旅行") and has_text(client, "出发"), "中文 toggle covers travel planner strings")
	client.page = "trade"
	client._render()
	check(has_text(client, "作为礼物送出"), "中文 toggle covers gift strings")
	L10n.lang = "en"
	# P2 codex: 120 entries, one family at a time, unreleased entries are silhouettes without names.
	check(client.load_codex().size() == 120, "Codex data has 120 entries")
	client.page = "collection"
	client.codex_open = true
	client.codex_family = 1
	client._render()
	check(has_text(client, "Coming later") and has_text(client, "P004") and has_text(client, "Moss"), "Codex shows D1 art names and Coming later silhouettes")
	check(not has_text(client, "Button Otter"), "Unreleased codex entries do not reveal names")
	client.codex_family = 12
	client._render()
	check(not has_text(client, "P001") and has_text(client, "Coming later"), "Codex switches family pages")
	await process_frame
	check(client.content.get_combined_minimum_size().x <= 360 - 36 + 1, "Codex fits 360 px (got %f)" % client.content.get_combined_minimum_size().x)
	check(not L10n._has_cjk(" ".join(texts(client.content))), "English codex contains no Chinese text")
	client.codex_open = false
	client._switch_profile()
	check(view.trips.is_empty() and view.collections.is_empty(), "Switching profile clears travel state")
	viewport.queue_free()
	await process_frame
	print("PixelPets travel: %d checks, %d failures" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
