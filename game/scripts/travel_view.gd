extends RefCounted
class_name TravelView
## Pack & Travel, Return/postcard, journey receipt and Keepsakes. All outcomes come from the server:
## the countdown only displays the server's ready_at, and the server decides when the postcard can open.

const ART_SCRIPT = preload("res://scripts/pet_art.gd")
const ITEM_ART = preload("res://scripts/keepsake_art.gd")
const RARITY_EN := {"common": "Common", "special": "Special"}

var host: Control
var catalog: Dictionary = {}
var supplies: Dictionary = {}
var collections: Dictionary = {}
var trips: Dictionary = {}        # pet_id -> latest trip view from the server
var clock_offset_ms: float = 0.0  # server_time - local time, measured on each response
var route_id: String = "sunny_market"
var packing_id: String = "snack_tin"
var loading: bool = false
var loaded_generation: int = -1
var countdown_label: Label
var countdown_ready: bool = false
var timer: Timer
var pending_events: Dictionary = {}
var last_error: String = ""
var refresh_sequence: int = 0
var refresh_queued: bool = false
var refreshing_pet: String = ""
var postcards: Array = []
var album_loading: bool = false
var album_error: String = ""
var album_sequence: int = 0
var odds_open: bool = false
var receipt_open: bool = false

func _init(owner: Control) -> void:
	host = owner
	timer = Timer.new()
	timer.wait_time = 0.5
	timer.timeout.connect(_tick)
	host.add_child(timer)
	timer.start()

func reset() -> void:
	catalog.clear(); supplies.clear(); collections.clear(); trips.clear(); pending_events.clear()
	loaded_generation = -1
	refresh_sequence += 1
	loading = false
	refresh_queued = false
	last_error = ""
	countdown_label = null
	clock_offset_ms = 0.0
	countdown_ready = false
	postcards.clear()
	album_sequence += 1
	album_loading = false
	album_error = ""

# ---------------------------------------------------------------- data
func refresh(force: bool = false) -> void:
	if not host.online:
		return
	var pet_id: String = str(host.current_pet().get("id", ""))
	if loading:
		refresh_queued = refresh_queued or (force and pet_id != refreshing_pet)
		return
	if not force and loaded_generation == host.account_generation and (pet_id.is_empty() or trips.has(pet_id)):
		return
	loading = true
	refreshing_pet = pet_id
	last_error = ""
	refresh_sequence += 1
	var sequence: int = refresh_sequence
	var generation: int = host.account_generation
	var api: PetAPI = host.api
	if host.page in ["travel", "collection", "trade"]:
		host.call_deferred("_render")
	var got_catalog: Dictionary = await api.request("/travel/catalog")
	if sequence != refresh_sequence or generation != host.account_generation:
		return
	var got_collections: Dictionary = await api.request("/collections")
	if sequence != refresh_sequence or generation != host.account_generation:
		return
	var got_current: Dictionary = {}
	if not pet_id.is_empty():
		got_current = await api.request("/pets/" + pet_id + "/trips/current")
	if sequence != refresh_sequence or generation != host.account_generation:
		return
	loading = false
	if got_catalog.get("ok", false):
		catalog = got_catalog["data"]
	if got_collections.get("ok", false):
		collections = got_collections["data"]
	if got_current.get("ok", false):
		if got_current["data"].get("trip") == null:
			trips[pet_id] = {}
		_accept(got_current["data"])
	for response in [got_catalog, got_collections, got_current]:
		if not response.is_empty() and not response.get("ok", false):
			last_error = PetAPI.error_message(response)
			break
	if last_error.is_empty():
		loaded_generation = generation
	else:
		loaded_generation = -1
		host._set_status(last_error)
	# A selection made during a request gets its own authoritative trip lookup.
	if refresh_queued or str(host.current_pet().get("id", "")) != pet_id:
		refresh_queued = false
		refresh(true)
	if host.page in ["travel", "collection", "trade"]:
		host._render()

func _render_refresh_error(content: VBoxContainer) -> void:
	if loading:
		content.add_child(host._label(_t("Updating travel details…", "正在更新旅行信息……"), 13, host.MUTED))
		return
	if last_error.is_empty():
		return
	var notice: VBoxContainer = host._panel(content, Color("f6e3dc"))
	notice.add_child(host._label(last_error, 14))
	var retry: Button = host._button(_t("Try again", "重新加载"), func(): refresh(true), true)
	retry.disabled = loading or not host.online
	notice.add_child(retry)

func _accept(data: Dictionary) -> void:
	if data.get("supplies") is Dictionary:
		supplies = data["supplies"]
		_measure_clock(str(supplies.get("server_time", "")))
	var trip: Variant = data.get("trip")
	if trip is Dictionary:
		trips[str(trip["pet_id"])] = trip
		_measure_clock(str(trip.get("server_time", "")))
	if data.get("pet") is Dictionary:
		host._upsert_pet(data["pet"])

static func iso_ms(value: String) -> float:
	if value.is_empty():
		return 0.0
	var parts: PackedStringArray = value.trim_suffix("Z").split(".")
	var seconds: float = float(Time.get_unix_time_from_datetime_string(parts[0]))
	var fraction: float = float(("0." + parts[1])) if parts.size() > 1 else 0.0
	return seconds * 1000.0 + fraction * 1000.0

func _measure_clock(server_time: String) -> void:
	if not server_time.is_empty():
		clock_offset_ms = iso_ms(server_time) - Time.get_unix_time_from_system() * 1000.0

func remaining_ms(trip: Dictionary) -> float:
	return iso_ms(str(trip.get("ready_at", ""))) - (Time.get_unix_time_from_system() * 1000.0 + clock_offset_ms)

func demo_label() -> String:
	var ms: int = int(catalog.get("demo", {}).get("duration_ms", 45000))
	return ("Demo trip · %d seconds" % roundi(ms / 1000.0)) if L10n.lang == "en" else ("演示加速 · %d 秒" % roundi(ms / 1000.0))

func _event(key: String) -> String:
	if not pending_events.has(key):
		pending_events[key] = PetAPI.event_id()
	return str(pending_events[key])

# ---------------------------------------------------------------- travel page
func render(content: VBoxContainer) -> void:
	countdown_label = null
	content.add_child(host._label(_t("Pack & Travel", "收拾行囊去旅行"), 23))
	content.add_child(host._label(_t("Send your companion on a short trip. It comes back with a postcard and maybe a keepsake.", "让伙伴出门走一小段路，带回一张明信片，也许还有一件纪念物。"), 14, host.MUTED))
	_render_refresh_error(content)
	if catalog.is_empty():
		if last_error.is_empty():
			content.add_child(host._label(_t("Loading destinations…", "正在载入目的地……") if host.online else _t("Connect to the game server to travel.", "连接伙伴服务后才能旅行。"), 15))
		if not loading and last_error.is_empty() and loaded_generation != host.account_generation:
			refresh()
		return
	var pet: Dictionary = host.current_pet()
	if pet.is_empty():
		var empty: VBoxContainer = host._panel(content)
		empty.add_child(host._label(_t("Adopt a companion first — it's free.", "先免费领养一位伙伴吧。"), 17))
		empty.add_child(host._button(_t("Adopt a companion", "去领养"), func(): host._switch_page("companion"), true))
		return
	if not trips.has(str(pet["id"])):
		if last_error.is_empty():
			content.add_child(host._label(_t("Checking this companion's trip…", "正在查看这位伙伴的旅行……"), 15, host.MUTED))
			if not loading:
				refresh()
		return
	var trip: Dictionary = trips.get(str(pet["id"]), {})
	var state: String = str(trip.get("state", ""))
	_render_supplies(content)
	if state == "travelling":
		_render_away(content, pet, trip)
	elif state == "revealed" and not bool(trip.get("_dismissed", false)):
		render_postcard(content, pet, trip)
	else:
		if state == "cancelled" and not bool(trip.get("_dismissed", false)):
			var note: VBoxContainer = host._panel(content, Color("f6e3dc"))
			note.add_child(host._label(_t("The last trip was cancelled because this companion changed owner. Its supply was refunded.", "上一次旅行因伙伴归属变化而取消，补给已退回。"), 14))
		_render_planner(content, pet)
	_render_odds(content)

func _render_supplies(content: VBoxContainer) -> void:
	var row: VBoxContainer = host._panel(content, Color("f0f1e5"))
	var balance: int = int(supplies.get("balance", 0))
	var cap: int = int(supplies.get("daily_cap", 3))
	row.add_child(host._label(_t("Free supplies: %d / %d", "免费补给：%d / %d") % [balance, cap], 16))
	row.add_child(host._label(_t("Each trip uses 1. Refills to %d every day at 00:00 UTC. No cash value.", "每次旅行用 1 份。每天 UTC 0 点补满 %d 份，没有现金价值。") % cap, 12, host.MUTED))

func _render_planner(content: VBoxContainer, pet: Dictionary) -> void:
	var box: VBoxContainer = host._panel(content)
	box.add_child(host._label(_t("Travelling with %s", "和 %s 一起出发") % str(pet.get("nickname", "")), 13, host.MUTED))
	var preview: PetArt = ART_SCRIPT.new()
	preview.species = str(pet.get("species_id", "moss"))
	preview.form = str(pet.get("form", "seed"))
	preview.scene = route_id
	preview.habitat = str(_route(route_id).get("trait", "sun"))
	preview.custom_minimum_size.y = 145 if host.small_layout else 180
	box.add_child(preview)
	var sections: BoxContainer = VBoxContainer.new() if host.small_layout else HBoxContainer.new()
	sections.add_theme_constant_override("separation", 18)
	box.add_child(sections)
	var destinations := VBoxContainer.new()
	destinations.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	destinations.add_theme_constant_override("separation", 8)
	sections.add_child(destinations)
	destinations.add_child(host._label(_t("Where to?", "去哪里？"), 19))
	for route in catalog.get("routes", []):
		var id: String = str(route["id"])
		var button: Button = host._button(L10n.pick(route["name"]), func():
			route_id = id
			host._render(), route_id == id)
		destinations.add_child(button)
		if route_id == id:
			destinations.add_child(host._label(L10n.pick(route.get("blurb", {})), 13, host.MUTED))
	var packs := VBoxContainer.new()
	packs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	packs.add_theme_constant_override("separation", 8)
	sections.add_child(packs)
	packs.add_child(host._label(_t("Pack something", "带点什么"), 19))
	for packing in catalog.get("packings", []):
		var pid: String = str(packing["id"])
		var pick: Button = host._button(L10n.pick(packing["name"]), func():
			packing_id = pid
			host._render(), packing_id == pid)
		pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		packs.add_child(pick)
	packs.add_child(host._label(_t("Packing changes the story, not the odds.", "行囊只改变故事，不改变概率。"), 12, host.MUTED))
	box.add_child(host._label(demo_label(), 14, host.CORAL))
	var access: String = host._pet_access_message(pet)
	var go: Button = host._button(_t("Pack & go", "出发"), start_trip, true)
	go.disabled = host.busy or loading or not last_error.is_empty() or not host.online or int(supplies.get("balance", 0)) < 1 or not access.is_empty()
	box.add_child(go)
	if not access.is_empty():
		box.add_child(host._label(access, 13, host.CORAL))
	elif int(supplies.get("balance", 0)) < 1:
		box.add_child(host._label(_t("No supplies left today. They refill at 00:00 UTC.", "今天的补给用完了，UTC 0 点补满。"), 13, host.CORAL))

func _render_away(content: VBoxContainer, pet: Dictionary, trip: Dictionary) -> void:
	var box: VBoxContainer = host._panel(content)
	var route: Dictionary = _route(str(trip.get("route_id", "")))
	var arrived: bool = remaining_ms(trip) <= 0
	box.add_child(host._label((_t("Back from %s", "从%s回来了") if arrived else _t("On the way to %s", "正在前往%s")) % L10n.pick(route.get("name", {})), 19))
	var art: PetArt = ART_SCRIPT.new()
	art.species = str(pet.get("species_id", "moss"))
	art.form = str(pet.get("form", "seed"))
	art.habitat = str(route.get("trait", "sun"))
	art.scene = str(trip.get("route_id", "garden"))
	art.custom_minimum_size.y = 200
	box.add_child(art)
	box.add_child(host._label(demo_label(), 13, host.CORAL))
	countdown_label = host._label("", 18)
	box.add_child(countdown_label)
	countdown_ready = remaining_ms(trip) <= 0
	_update_countdown(trip)
	if countdown_ready:
		box.add_child(host._label(_t("Your companion is back", "伙伴回来了"), 21))
		var open: Button = host._button(_t("Open the postcard", "揭晓明信片"), reveal_trip.bind(str(trip["id"])), true)
		open.disabled = host.busy
		box.add_child(open)
	else:
		box.add_child(host._label(_t("The server decides when it's back; refreshing won't change the result.", "归来时间由服务器决定，刷新不会改变结果。"), 12, host.MUTED))

func _update_countdown(trip: Dictionary) -> void:
	if not is_instance_valid(countdown_label):
		return
	var left: float = remaining_ms(trip)
	countdown_label.text = _t("Back in %d s", "还有 %d 秒") % ceili(left / 1000.0) if left > 0 else _t("Arrived home", "到家了")

func _tick() -> void:
	if host.page != "travel" or not is_instance_valid(countdown_label):
		return
	var trip: Dictionary = trips.get(str(host.current_pet().get("id", "")), {})
	if str(trip.get("state", "")) != "travelling":
		return
	_update_countdown(trip)
	if not countdown_ready and remaining_ms(trip) <= 0:
		host._render()

func render_postcard(content: VBoxContainer, pet: Dictionary, trip: Dictionary, archived: bool = false) -> void:
	var result: Dictionary = trip.get("result", {})
	var story: Dictionary = result.get("story", {}).get(L10n.lang, result.get("story", {}).get("en", {}))
	var card: VBoxContainer = host._panel(content, Color("fff6e0"))
	card.add_child(host._label(_t("Postcard", "明信片"), 13, host.MUTED))
	card.add_child(host._label(str(story.get("title", "")), 21))
	var art: PetArt = ART_SCRIPT.new()
	art.species = str(pet.get("species_id", "moss"))
	art.form = str(pet.get("form", "seed"))
	art.scene = str(trip.get("route_id", "garden"))
	art.habitat = str(_route(art.scene).get("trait", "sun"))
	art.custom_minimum_size.y = 180
	card.add_child(art)
	card.add_child(host._label(str(trip.get("settled_at", "")).replace("T", " ").left(16) + " UTC", 12, host.MUTED))
	for line in story.get("lines", []):
		card.add_child(host._label(str(line), 15))
	for item in result.get("items", []):
		var rarity: String = str(item.get("rarity", "common"))
		var keepsake := ITEM_ART.new()
		keepsake.item_id = str(item.get("id", ""))
		keepsake.custom_minimum_size.y = 88
		card.add_child(keepsake)
		card.add_child(host._label(_t("Keepsake: ", "纪念物：") + "%s  ·  %s" % [L10n.pick(item.get("name", {})), str(RARITY_EN.get(rarity, rarity)) if L10n.lang == "en" else ("特别" if rarity == "special" else "常见")], 16, host.CORAL if rarity == "special" else host.INK))
	if result.get("clue") != null:
		card.add_child(host._label(_t("A clue about a companion that is coming later (%s).", "发现了一位未来伙伴的线索（%s，尚未开放）。") % str(result.get("clue")), 13, host.MUTED))
	card.add_child(host._label(_t("Saved in your postcard album. Come back to this memory any time.", "已放进明信片相册，随时可以回来翻看这段回忆。"), 13, host.MUTED))
	# Optional chain details stay available without crowding the reward reveal.
	var receipt_toggle: Button = host._button(_t("Journey receipt", "旅程收据") + (" −" if receipt_open else " +"), func():
		receipt_open = not receipt_open
		if archived:
			open_postcard(trip)
		else:
			host._render())
	card.add_child(receipt_toggle)
	if receipt_open:
		_render_receipt(card, pet, trip)
	if not archived:
		card.add_child(host._button(_t("View postcard album", "翻看明信片相册"), func(): host._switch_page("collection")))
		card.add_child(host._button(_t("Plan another trip", "再计划一次旅行"), func():
			trip["_dismissed"] = true
			host._render(), true))

func _render_receipt(card: VBoxContainer, pet: Dictionary, trip: Dictionary) -> void:
	card.add_child(host._label(_t("Journey receipt", "旅程收据"), 17))
	card.add_child(host._label("%s · %s" % [str(trip.get("public_receipt_id", "")), str(trip.get("result", {}).get("result_hash", "")).left(16) + "…"], 12, host.MUTED))
	var receipt: Variant = trip.get("receipt")
	# A prepared intent that was never signed is not a submission; show the plain Save action again.
	if receipt is Dictionary and str(receipt.get("status", "")) == "prepared" and receipt.get("signature") == null:
		receipt = null
	var registered: bool = host._requires_wallet(pet)
	var devnet: bool = str(host.chain_config.get("network", "")).contains("devnet")
	if receipt is Dictionary and str(receipt.get("status", "")) == "confirmed":
		card.add_child(host._label(_t("Confirmed on Solana Devnet", "已在 Solana Devnet 确认") if devnet else _t("Confirmed on Solana (%s)", "已在 Solana 确认（%s）") % str(host.chain_config.get("network", "")), 16, Color("3c7a52")))
		var signature: String = str(receipt.get("signature", ""))
		card.add_child(host._label("Tx " + signature.left(10) + "…" + signature.right(8), 12, host.MUTED))
		var proof_url: String = host.api.base_url + "/api/v1/trips/" + str(trip.get("public_receipt_id", "")) + "/proof"
		card.add_child(host._button(_t("Open public proof", "打开公开证明"), func(): OS.shell_open(proof_url)))
		if devnet and not signature.is_empty():
			card.add_child(host._button(_t("View transaction in Solana Explorer", "在 Solana Explorer 查看交易"), func(): OS.shell_open("https://explorer.solana.com/tx/%s?cluster=devnet" % signature)))
		return
	if receipt is Dictionary and str(receipt.get("status", "")) in ["failed", "expired"]:
		card.add_child(host._label(_t("The last save didn't land. You can try again.", "上次保存没有成功，可以再试一次。"), 13, host.CORAL))
	elif receipt is Dictionary:
		card.add_child(host._label(_t("Submitted · checking confirmation", "已提交 · 正在确认"), 15, host.CORAL))
	if not registered:
		card.add_child(host._label(_t("Claim this companion on Devnet to save the trip result on Solana. Optional — the postcard is already yours.", "在 Devnet 领取这位伙伴后，可以把旅程结果保存到 Solana。可选，明信片已经是你的了。"), 13, host.MUTED))
		var claim: Button = host._button(_t("Claim on Devnet", "在 Devnet 领取"), func(): host._switch_page("trade"))
		claim.disabled = not bool(host.chain_config.get("enabled", false))
		card.add_child(claim)
		if not bool(host.chain_config.get("enabled", false)):
			card.add_child(host._label(_t("Devnet claiming is not open on this server yet.", "此服务器尚未开放 Devnet 领取。"), 12, host.MUTED))
		return
	var access: String = host._pet_access_message(pet)
	var label: String = _t("Check confirmation", "再次确认") if receipt is Dictionary and not str(receipt.get("status", "")) in ["failed", "expired"] else _t("Save journey receipt", "保存旅程收据")
	var save: Button = host._button(label, save_receipt.bind(str(pet["id"]), str(trip["id"])), true)
	save.disabled = host.busy or not access.is_empty() or not bool(host.chain_config.get("enabled", false))
	card.add_child(save)
	card.add_child(host._label(_t("Your wallet shows the fee before you approve. One small Devnet transaction.", "批准前钱包会显示费用。只需一笔小额 Devnet 交易。"), 12, host.MUTED))
	if not access.is_empty():
		card.add_child(host._label(access, 12, host.CORAL))

func _render_odds(content: VBoxContainer) -> void:
	content.add_child(host._button(_t("How results work", "结果如何决定") + (" −" if odds_open else " +"), func():
		odds_open = not odds_open
		host._render()))
	if not odds_open:
		return
	var odds: Dictionary = catalog.get("odds", {})
	var info: VBoxContainer = host._panel(content, Color("f0f1e5"))
	info.add_child(host._label(_t("How results work", "结果如何决定"), 16))
	var parts: PackedStringArray = []
	for tier in odds.get("tiers", []):
		var names: Dictionary = {"common": _t("Common", "常见"), "repeat": _t("Duplicate", "重复"), "special": _t("Special", "特别"), "clue": _t("Clue", "线索")}
		parts.append("%s %d%%" % [str(names.get(str(tier.get("tier", "")), "")), int(tier.get("percent", 0))])
	info.add_child(host._label(", ".join(parts), 13))
	info.add_child(host._label(_t("Rewards are drawn by the server. Packing changes the story, not the odds. Keepsakes have no cash value.", "奖励由服务器抽取；行囊改变故事，不改变概率。纪念物是游戏内收藏，没有现金价值。"), 12, host.MUTED))

# ---------------------------------------------------------------- keepsakes (Collection page)
func render_keepsakes(content: VBoxContainer) -> void:
	content.add_child(host._label(_t("Keepsakes", "旅途收藏"), 23))
	_render_refresh_error(content)
	if collections.is_empty():
		if last_error.is_empty():
			content.add_child(host._label(_t("Loading keepsakes…", "正在载入收藏……") if host.online else _t("Connect to see keepsakes.", "连接后查看收藏。"), 14, host.MUTED))
		if not loading and last_error.is_empty() and loaded_generation != host.account_generation:
			refresh()
		return
	content.add_child(host._label(_t("%d / %d found. Separate from your companion cards.", "已找到 %d / %d 件，与伙伴卡册分开记录。") % [int(collections.get("discovered", 0)), int(collections.get("total", 8))], 14, host.MUTED))
	var grid := GridContainer.new()
	grid.columns = 2 if host.small_layout else 4
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	content.add_child(grid)
	for item in collections.get("collectibles", []):
		var found: bool = bool(item.get("discovered", false))
		var card: VBoxContainer = host._panel(grid, Color("fffdf5") if found else Color("efeee5"))
		card.get_parent().size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var art := ITEM_ART.new()
		art.item_id = str(item.get("id", ""))
		art.discovered = found
		art.custom_minimum_size.y = 82
		card.add_child(art)
		card.add_child(host._label(("★ " if str(item.get("rarity", "")) == "special" else "") + (L10n.pick(item.get("name", {})) if found else "???"), 14, host.INK if found else host.MUTED))
		card.add_child(host._label(L10n.pick(item.get("description", {})) if found else L10n.pick(_route(str(item.get("route", ""))).get("name", {})), 11, host.MUTED))
		if found and int(item.get("quantity", 0)) > 1:
			card.add_child(host._label("× %d" % int(item.get("quantity", 0)), 12, host.MUTED))
	_render_album(content)

func refresh_album() -> void:
	if album_loading or not host.online:
		return
	album_loading = true
	album_error = ""
	album_sequence += 1
	var sequence: int = album_sequence
	var generation: int = host.account_generation
	var response: Dictionary = await host.api.request("/trips")
	if sequence != album_sequence or generation != host.account_generation:
		return
	album_loading = false
	if response.get("ok", false):
		postcards = response["data"].get("trips", []).filter(func(trip: Dictionary): return trip.get("state") == "revealed")
	else:
		album_error = PetAPI.error_message(response)
	if host.page == "collection":
		host._render()

func _render_album(content: VBoxContainer) -> void:
	content.add_child(host._label(_t("Postcard album", "明信片相册"), 23))
	content.add_child(host._label(_t("Your last 50 journeys, newest first. Tap a postcard to read it again.", "最近 50 次旅程，按时间排列。轻点明信片，再读一次小故事。"), 13, host.MUTED))
	if album_loading:
		content.add_child(host._label(_t("Opening the album…", "正在翻开相册……"), 14))
	if not album_error.is_empty():
		content.add_child(host._label(album_error, 14, host.CORAL))
		content.add_child(host._button(_t("Try again", "重新加载"), refresh_album))
	if postcards.is_empty() and not album_loading and album_error.is_empty():
		var empty: VBoxContainer = host._panel(content)
		empty.add_child(host._label(_t("A little world is waiting", "小小的世界正在等你"), 18))
		empty.add_child(host._label(_t("Finish a trip and open its postcard. It will be kept here.", "完成一次旅行、揭晓明信片，它就会珍藏在这里。"), 14, host.MUTED))
		empty.add_child(host._button(_t("Take a trip", "去旅行"), func(): host._switch_page("travel"), true))
	for trip in postcards:
		var story: Dictionary = trip.get("result", {}).get("story", {}).get(L10n.lang, {})
		var row: VBoxContainer = host._panel(content, Color("fff6e0"))
		row.add_child(host._label(str(trip.get("settled_at", "")).replace("T", " ").left(16) + " UTC", 12, host.MUTED))
		row.add_child(host._button(str(story.get("title", "Postcard")), open_postcard.bind(trip)))

func open_postcard(trip: Dictionary) -> void:
	var pet: Dictionary = {}
	for companion in host.pets:
		if companion.get("id") == trip.get("pet_id"):
			pet = companion
			break
	var body: VBoxContainer = host._open_modal(_t("A memory to keep", "珍藏的小回忆"))
	render_postcard(body, pet, trip, true)

# ---------------------------------------------------------------- actions
func start_trip() -> void:
	var pet: Dictionary = host.current_pet()
	if host.busy or loading or not host.online or not last_error.is_empty() or pet.is_empty() or not trips.has(str(pet.get("id", ""))) or not host._pet_access_message(pet).is_empty():
		return
	var key: String = "trip:%s:%s:%s" % [str(pet["id"]), route_id, packing_id]
	var body := {"event_id": _event(key), "route_id": route_id, "packing_id": packing_id}
	var result: Dictionary = await _call(pet, "start", "", body, "/pets/" + str(pet["id"]) + "/trips", HTTPClient.METHOD_POST)
	if result.is_empty():
		return
	if result.get("ok", false):
		pending_events.erase(key)
		_accept(result["data"])
		host._set_status(_t("Off it goes! %s", "出发啦！%s") % demo_label())
	else:
		if int(result.get("http_status", 400)) < 500:
			pending_events.erase(key)
		host._set_status(PetAPI.error_message(result))
		if str(result.get("error", {}).get("code", "")) == "TRIP_ACTIVE":
			refresh(true)
	host._render()

func reveal_trip(trip_id: String) -> void:
	var pet: Dictionary = host.current_pet()
	if host.busy or pet.is_empty():
		return
	var key: String = "reveal:" + trip_id
	var result: Dictionary = await _call(pet, "reveal", trip_id, {"event_id": _event(key)}, "/trips/" + trip_id + "/reveal", HTTPClient.METHOD_POST)
	if result.is_empty():
		return
	if result.get("ok", false):
		pending_events.erase(key)
		var data: Dictionary = result["data"]
		if bool(data.get("cancelled", false)):
			host._set_status(L10n.error_text({"error": {"code": "PET_OWNER_CHANGED"}}))
		else:
			host._set_status(_t("Your companion is back with a postcard.", "伙伴带着明信片回来了。"))
		_accept(data)
		collections.clear()
		_refresh_collections()
	else:
		var code: String = str(result.get("error", {}).get("code", ""))
		host._set_status(PetAPI.error_message(result))
		if code in ["TRIP_NOT_READY", "TRIP_ALREADY_SETTLED", "PET_OWNER_CHANGED"]:
			refresh(true)
	host._render()

func save_receipt(pet_id: String, trip_id: String) -> void:
	var trip: Dictionary = trips.get(pet_id, {})
	if host.busy or trip.is_empty():
		return
	host.busy = true
	host._set_status(_t("Check your wallet: review the fee, then approve.", "请在钱包里核对费用后批准。"))
	host._render()
	var generation: int = host.account_generation
	var result: Dictionary = await host._bridge_call("journey_receipt", {"pet_id": pet_id, "trip_id": trip_id, "result_hash": str(trip.get("result", {}).get("result_hash", ""))})
	if generation != host.account_generation:
		return
	host.busy = false
	if result.get("ok", false):
		var state: String = str(result.get("data", {}).get("state", ""))
		host._set_status(_t("Confirmed on Solana. Your journey receipt is saved.", "已在 Solana 确认，旅程收据已保存。") if state == "confirmed" else _t("Submitted · checking confirmation", "已提交 · 正在确认"))
		if result.get("data", {}).get("pet") is Dictionary:
			host._upsert_pet(result["data"]["pet"])
	else:
		host._set_status(PetAPI.error_message(result))
	var fresh: Dictionary = await host.api.request("/trips/" + trip_id)
	if generation == host.account_generation and fresh.get("ok", false):
		_accept(fresh["data"])
	host._render()

func _refresh_collections() -> void:
	var generation: int = host.account_generation
	var got: Dictionary = await host.api.request("/collections")
	if generation == host.account_generation and got.get("ok", false):
		collections = got["data"]
		if host.page in ["travel", "collection"]:
			host._render()

## Guest pets call the API directly; wallet-registered pets go through the wallet session in the bridge.
func _call(pet: Dictionary, op: String, trip_id: String, body: Dictionary, path: String, method: HTTPClient.Method) -> Dictionary:
	var generation: int = host.account_generation
	host.busy = true
	host._render()
	var result: Dictionary
	if host._requires_wallet(pet):
		result = await host._bridge_call("travel", {"op": op, "pet_id": str(pet["id"]), "trip_id": trip_id, "body": body})
	else:
		result = await host.api.request(path, method, body)
	if generation != host.account_generation:
		return {}
	host.busy = false
	return result

func _route(id: String) -> Dictionary:
	for route in catalog.get("routes", []):
		if str(route.get("id", "")) == id:
			return route
	return {}

static func _t(en: String, zh: String) -> String:
	return en if L10n.lang == "en" else zh
