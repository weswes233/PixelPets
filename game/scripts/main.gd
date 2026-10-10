extends Control

const API_SCRIPT = preload("res://scripts/api_client.gd")
const TRAVEL_SCRIPT = preload("res://scripts/travel_view.gd")

signal bridge_settled(request_id: String, result: Dictionary)
const ART_SCRIPT = preload("res://scripts/pet_art.gd")
const FONT = preload("res://assets/fonts/NotoSansSC-Medium.ttf")
const INK := Color("344a48")
const MUTED := Color("75817a")
const CREAM := Color("f8f4e8")
const MINT := Color("d5e7d4")
const CORAL := Color("c77660")
const SPECIES := {
	"moss": {"name": "苔苔", "description": "会把每一片落叶当作礼物的小猫。", "sun": "向阳苔苔", "moon": "月影苔苔"},
	"puddle": {"name": "啵啵", "description": "喜欢坐在水边，陪你发一会儿呆。", "sun": "晴天啵啵", "moon": "夜露啵啵"},
	"wisp": {"name": "微光", "description": "有点害羞，但总会为你留一盏小灯。", "sun": "晨曦微光", "moon": "星夜微光"}
}

var api: PetAPI
var pets: Array = []
var journal: Array = []
var selected_pet: String = ""
var selected_species: String = "moss"
var page: String = "companion"
var online: bool = false
var busy: bool = false
var status_text: String = "正在寻找你的伙伴……"
var chain_config: Dictionary = {"enabled": false, "network": "未配置"}
var wallet: Dictionary = {}
var market_page: Dictionary = {}
var bridge: JavaScriptObject
var bridge_callback: JavaScriptObject
var pending_actions: Dictionary = {}
var content: VBoxContainer
var status_label: Label
var navigation: HBoxContainer
var pet_art: PetArt
var name_input: LineEdit
var gift_input: LineEdit
var gift_recipient: String = ""
var gift_pending: bool = false
var codex_entries: Array = []
var codex_open: bool = false
var codex_family: int = 1
var modal: Control
var adventure_count: int = 0
var adventure_choice: String = "sun"
var adventure_field: Control
var small_layout: bool = false
var boot_generation: int = 0
var testing: bool = false
var account_generation: int = 0
var bridge_requests: Dictionary = {}
var pet_list_generation: int = 0
var travel: TravelView
var shell_texts: Array = []

func _ready() -> void:
	testing = "--client-test" in OS.get_cmdline_user_args()
	if not testing:
		var settings := ConfigFile.new()
		if settings.load("user://settings.cfg") == OK and str(settings.get_value("ui", "lang", "en")) in ["en", "zh"]:
			L10n.lang = str(settings.get_value("ui", "lang", "en"))
	small_layout = size.x < 650
	_build_shell()
	api = API_SCRIPT.new()
	api.test_mode = testing
	add_child(api)
	travel = TRAVEL_SCRIPT.new(self)
	_setup_bridge()
	resized.connect(_on_resized)
	if testing:
		_render()
	else:
		_boot()

func _build_shell() -> void:
	var ui_theme := Theme.new()
	ui_theme.default_font = FONT
	ui_theme.default_font_size = 16
	ui_theme.set_color("font_color", "Label", INK)
	ui_theme.set_color("font_color", "Button", INK)
	ui_theme.set_color("font_hover_color", "Button", INK)
	ui_theme.set_color("font_pressed_color", "Button", INK)
	ui_theme.set_color("font_focus_color", "Button", INK)
	ui_theme.set_color("font_disabled_color", "Button", MUTED)
	ui_theme.set_stylebox("normal", "Button", _box(Color("eeeadd"), 2))
	ui_theme.set_stylebox("hover", "Button", _box(MINT, 2))
	ui_theme.set_stylebox("pressed", "Button", _box(Color("b9d3b7"), 2))
	ui_theme.set_stylebox("disabled", "Button", _box(Color("e9e8df"), 1))
	ui_theme.set_stylebox("focus", "Button", _box(Color(0,0,0,0), 2, CORAL))
	ui_theme.set_stylebox("normal", "LineEdit", _box(Color("fffdf5"), 2))
	ui_theme.set_stylebox("focus", "LineEdit", _box(Color("fffdf5"), 2, CORAL))
	ui_theme.set_color("font_color", "LineEdit", INK)
	ui_theme.set_color("font_placeholder_color", "LineEdit", MUTED)
	theme = ui_theme
	var bg := ColorRect.new()
	bg.color = CREAM
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 18)
	add_child(margin)
	var shell := VBoxContainer.new()
	shell.add_theme_constant_override("separation", 12)
	margin.add_child(shell)
	var heading := HBoxContainer.new()
	shell.add_child(heading)
	var title := _label("掌心伙伴", 27)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.set_meta("source", "掌心伙伴")
	shell_texts.append(title)
	heading.add_child(title)
	var language := Button.new()
	language.text = "中文" if L10n.lang == "en" else "EN"
	language.tooltip_text = "Language / 语言"
	language.custom_minimum_size = Vector2(56, 36)
	language.pressed.connect(func():
		_set_language("zh" if L10n.lang == "en" else "en")
		language.text = "中文" if L10n.lang == "en" else "EN")
	heading.add_child(language)
	var tagline := _label("小小的陪伴，慢慢成为独一无二。", 14, MUTED)
	tagline.set_meta("source", "小小的陪伴，慢慢成为独一无二。")
	shell_texts.append(tagline)
	shell.add_child(tagline)
	navigation = HBoxContainer.new()
	navigation.add_theme_constant_override("separation", 7)
	shell.add_child(navigation)
	for item in [["companion", "陪伴"], ["travel", "旅行"], ["collection", "卡册"], ["journal", "日记"], ["trade", "交换"]]:
		var button := _button(str(item[1]), func(): _switch_page(str(item[0])))
		button.set_meta("page", str(item[0]))
		button.set_meta("source", str(item[1]))
		button.clip_text = true
		button.add_theme_font_size_override("font_size", 13)
		shell_texts.append(button)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		navigation.add_child(button)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	shell.add_child(scroll)
	content = VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 16)
	scroll.add_child(content)
	status_label = _label(status_text, 13, MUTED)
	status_label.custom_minimum_size.y = 36
	shell.add_child(status_label)

func _box(color: Color, border: int = 1, border_color: Color = Color("ced3c4")) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_border_width_all(border)
	style.border_color = border_color
	style.content_margin_left = 12
	style.content_margin_right = 12
	style.content_margin_top = 10
	style.content_margin_bottom = 10
	return style

func _label(value: String, font_size: int = 16, color: Color = INK) -> Label:
	var label := Label.new()
	label.text = L10n.t(value)
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return label

func _button(value: String, callback: Callable, primary: bool = false) -> Button:
	var button := Button.new()
	button.text = L10n.t(value)
	button.custom_minimum_size.y = 45
	button.pressed.connect(callback)
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if primary:
		button.add_theme_stylebox_override("normal", _box(MINT, 2, Color("a8bea1")))
	return button

func _panel(parent: Node, tint: Color = Color("fffdf5")) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_theme_stylebox_override("panel", _box(tint, 2))
	parent.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)
	return box

func _boot() -> void:
	boot_generation += 1
	var generation: int = boot_generation
	busy = true
	_set_status("正在连接伙伴小屋……")
	_render()
	if api.token.is_empty():
		var guest: Dictionary = await api.request("/guests", HTTPClient.METHOD_POST)
		if generation != boot_generation:
			return
		if not guest.get("ok", false):
			_boot_failed(guest)
			return
		if not api.save_token(str(guest["data"]["token"])):
			_boot_failed({"error": {"message": "无法保存本机通行证，请检查浏览器存储或磁盘空间后重试。"}})
			return
	var response: Dictionary = await api.request("/pets")
	if generation != boot_generation:
		return
	if int(response.get("http_status", 0)) == 401:
		var cleared: bool = api.save_token("")
		busy = false
		_set_status("这张通行证已过期。可在交换页用原钱包找回，或重连创建新档案。" if cleared else "通行证已过期，但本机存储暂时无法更新。请检查浏览器存储或磁盘空间后重试。")
		online = false
		_render()
		return
	if not response.get("ok", false):
		_boot_failed(response)
		return
	pets = response["data"].get("pets", [])
	if selected_pet.is_empty() and not pets.is_empty():
		selected_pet = str(pets[0]["id"])
	online = true
	busy = false
	_set_status("小屋已连接。每次照顾都会留下真实的小记忆。")
	_send_bridge("set_session", {"token": api.token})
	_render()
	var configured: Dictionary = await api.request("/chain/config")
	if generation != boot_generation:
		return
	if configured.get("ok", false):
		chain_config = configured["data"]
	if page == "trade":
		_render()
	travel.refresh(true)
	if wallet.get("authenticated", false):
		_sync_assets()

func _boot_failed(result: Dictionary) -> void:
	online = false
	busy = false
	_set_status(API_SCRIPT.error_message(result))
	_render()

func _set_status(value: String) -> void:
	status_text = L10n.t(value)
	if is_instance_valid(status_label):
		status_label.text = status_text

func _on_resized() -> void:
	var now_small: bool = size.x < 650
	if small_layout != now_small:
		small_layout = now_small
		_render()

func _clear_content() -> void:
	pet_art = null
	for child in content.get_children():
		content.remove_child(child)
		child.queue_free()

func _set_language(next: String) -> void:
	L10n.lang = next
	if not testing:
		var settings := ConfigFile.new()
		settings.set_value("ui", "lang", next)
		settings.save("user://settings.cfg")
	for node in shell_texts:
		if is_instance_valid(node):
			node.text = L10n.t(str(node.get_meta("source")))
	_render()

func _switch_page(next: String) -> void:
	page = next
	_render()
	if page in ["companion", "travel", "collection", "trade"] and online:
		travel.refresh(true)
	if page == "journal" and online:
		_load_journal()
	elif page == "trade":
		_send_bridge("status")

func _render() -> void:
	if not is_instance_valid(content):
		return
	_clear_content()
	for child in navigation.get_children():
		var nav_button := child as Button
		for state in ["normal", "hover", "pressed", "focus"]:
			var tab := _box((MINT if str(nav_button.get_meta("page")) == page else Color("eeeadd")) if state == "normal" else (MINT if state != "focus" else Color(0, 0, 0, 0)), 2, CORAL if state == "focus" else Color("ced3c4"))
			tab.content_margin_left = 2
			tab.content_margin_right = 2
			nav_button.add_theme_stylebox_override(state, tab)
	if not online:
		var notice := _panel(content)
		notice.add_child(_label("让相遇被记住", 21))
		notice.add_child(_label("领养与成长保存在伙伴服务里。连接成功后，就可以免费领养你的第一位伙伴。", 15, MUTED))
		var retry := _button("正在连接……" if busy else "重新连接", _boot, true)
		retry.disabled = busy
		notice.add_child(retry)
	match page:
		"companion": _render_companion()
		"travel": travel.render(content)
		"collection":
			travel.render_keepsakes(content)
			_render_collection()
		"journal": _render_journal()
		"trade": _render_trade()

func current_pet() -> Dictionary:
	for pet in pets:
		if str(pet.get("id", "")) == selected_pet:
			return pet
	return pets[0] if not pets.is_empty() else {}

func _render_companion() -> void:
	if pets.is_empty():
		_render_adoption()
		return
	if pets.size() > 1:
		var selector := OptionButton.new()
		selector.custom_minimum_size.y = 44
		for i in range(pets.size()):
			selector.add_item(str(pets[i].get("nickname", L10n.t("伙伴"))))
			if str(pets[i]["id"]) == selected_pet:
				selector.select(i)
		selector.item_selected.connect(func(index: int):
			selected_pet = str(pets[index]["id"])
			_render()
			travel.refresh(true)
		)
		content.add_child(selector)
	var pet: Dictionary = current_pet()
	var layout: BoxContainer = VBoxContainer.new() if small_layout else HBoxContainer.new()
	layout.add_theme_constant_override("separation", 18)
	content.add_child(layout)
	var card := _panel(layout)
	card.add_child(_label(str(pet.get("nickname", "伙伴")), 27))
	card.add_child(_label(_form_name(pet) + "  /  " + _chain_label(pet), 13, MUTED))
	var trip: Dictionary = travel.trips.get(str(pet["id"]), {})
	var travelling: bool = str(trip.get("state", "")) == "travelling"
	var away: bool = travelling and travel.remaining_ms(trip) > 0
	travel.home_was_away = away
	if away:
		card.add_child(_label("Away on a little adventure" if L10n.lang == "en" else "它出门旅行啦", 24))
		card.add_child(_label("A note left at home" if L10n.lang == "en" else "留在家里的小纸条", 15, CORAL))
		card.add_child(_label(L10n.pick(trip.get("departure_note", {})), 16))
		card.add_child(_label("You can close the page. The postcard will wait for you." if L10n.lang == "en" else "可以先关掉网页，回来时再拆明信片。", 13, MUTED))
	else:
		pet_art = ART_SCRIPT.new()
		pet_art.species = str(pet.get("species_id", "moss"))
		pet_art.form = str(pet.get("form", "seed"))
		pet_art.custom_minimum_size.y = 228 if small_layout else 298
		card.add_child(pet_art)
		if travelling:
			card.add_child(_label("Your companion is back with a postcard." if L10n.lang == "en" else "伙伴回来了，还带着一张明信片。", 16, CORAL))
			card.add_child(_button("Open the postcard" if L10n.lang == "en" else "去拆明信片", func(): _switch_page("travel"), true))
	var quote: String = "今天也很高兴见到你。一起出去走走吧。"
	if int(pet.get("energy", 0)) < 30:
		quote = "想找个舒服的角落，和你一起歇一会儿。"
	elif pet.get("form", "seed") != "seed":
		quote = "这些一起度过的日子，已经成为我的模样。"
	if not away:
		card.add_child(_label(quote, 15))
	var details := _panel(layout, Color("f0f1e5"))
	details.add_child(_label("我们的日常", 20))
	_meter(details, "亲密", int(pet.get("bond", 0)), 6, Color("c8937b"))
	_meter(details, "精神", int(pet.get("energy", 0)), 100, Color("93b397"))
	_meter(details, "心情", int(pet.get("mood", 0)), 100, Color("bdad76"))
	var bond: int = int(pet.get("bond", 0))
	details.add_child(_label(L10n.t("再积累 %d 点亲密，就会迎来新的模样。") % maxi(0, 6 - bond) if pet.get("form", "seed") == "seed" else "已经长成独特的模样。陪伴还会继续。", 14, MUTED))
	var actions := GridContainer.new()
	actions.columns = 2
	actions.add_theme_constant_override("h_separation", 8)
	actions.add_theme_constant_override("v_separation", 8)
	details.add_child(actions)
	var access_message: String = _pet_access_message(pet)
	for item in [["feed", "喂一口"], ["play", "陪它玩"], ["rest", "歇一会"], ["explore", "小小出游"]]:
		var action: String = str(item[0])
		var button := _button(str(item[1]), _open_adventure if action == "explore" else _care.bind(action, ""), action == "explore")
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.disabled = busy or not online or travelling or not access_message.is_empty()
		actions.add_child(button)
	details.add_child(_label("每种照顾都有自己的节奏。没有死亡，也不用担心落下一天。", 13, MUTED))
	if not access_message.is_empty():
		details.add_child(_label(access_message, 14, CORAL))
		details.add_child(_button("查看钱包与伙伴归属", func(): _switch_page("trade")))
	details.add_child(_button(("Pack & Travel" if L10n.lang == "en" else "收拾行囊去旅行"), func(): _switch_page("travel"), true))
	var rename := _button("给它取个新名字", _open_rename)
	rename.disabled = busy or not online or not access_message.is_empty()
	details.add_child(rename)
	if _adopted_count() < 3:
		content.add_child(_button(L10n.t("再认识一位伙伴  ·  %d / 3") % _adopted_count(), func(): _open_adoption()))

func _adopted_count() -> int:
	var count: int = 0
	for pet in pets:
		if not pet.get("chain", {}).get("received", false):
			count += 1
	return count

func _requires_wallet(pet: Dictionary) -> bool:
	return pet.get("chain", {}).get("status", "unregistered") == "registered"

func _pet_access_message(pet: Dictionary) -> String:
	if not _requires_wallet(pet):
		return ""
	var ownership: Dictionary = pet.get("ownership", {})
	if ownership.get("status", "unverified") == "escrow":
		return "伙伴正在等待成交，取回并同步归属后才能继续照顾。"
	if not wallet.get("authenticated", false):
		return "连接并验证钱包后，可以继续免费照顾这位链上伙伴。"
	if not ownership.get("can_interact", false):
		return "请先在交换页同步钱包伙伴，确认它仍属于你。"
	return ""

func _meter(parent: Node, title: String, value: int, maximum: int, color: Color) -> void:
	parent.add_child(_label("%s   %d%s" % [L10n.t(title), value, " / " + str(maximum) if title == "亲密" and value < maximum else ""], 14))
	var meter := ProgressBar.new()
	meter.max_value = maximum
	meter.value = mini(maximum, value)
	meter.show_percentage = false
	meter.custom_minimum_size.y = 8
	meter.add_theme_stylebox_override("background", _box(Color("dedfd0"), 0))
	meter.add_theme_stylebox_override("fill", _box(color, 0))
	parent.add_child(meter)

func _render_adoption(parent: Node = null) -> void:
	var target: Node = parent if parent != null else content
	var intro := _panel(target)
	intro.add_child(_label("从一个小小的相遇开始", 23))
	intro.add_child(_label("免费领养 · 照顾成长 · 收集回忆\n无需钱包即可开始；领养本身不会发行链上资产。", 14, MUTED))
	var choices := HBoxContainer.new()
	choices.add_theme_constant_override("separation", 8)
	intro.add_child(choices)
	for species_id in SPECIES:
		var choice := VBoxContainer.new()
		choice.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		choices.add_child(choice)
		var art := ART_SCRIPT.new()
		art.species = str(species_id)
		art.show_habitat = false
		art.custom_minimum_size = Vector2(70, 88)
		choice.add_child(art)
		choice.add_child(_button(str(SPECIES[species_id]["name"]), _choose_species.bind(str(species_id)), selected_species == species_id))
	intro.add_child(_label(str(SPECIES[selected_species]["description"]), 15))
	name_input = LineEdit.new()
	name_input.placeholder_text = "给伙伴起个名字（最多 16 字）"
	name_input.max_length = 16
	name_input.text = L10n.t(str(SPECIES[selected_species]["name"]))
	name_input.custom_minimum_size.y = 45
	intro.add_child(name_input)
	var adopt := _button("带它回家", _adopt, true)
	adopt.disabled = busy or not online or _adopted_count() >= 3
	intro.add_child(adopt)
	intro.add_child(_label("日光与月色会留下不同的成长印记。每种伙伴都有两条成长分支。", 13, MUTED))

func _choose_species(value: String) -> void:
	selected_species = value
	if is_instance_valid(modal):
		_open_adoption()
	else:
		_render()

func _open_adoption() -> void:
	var body := _open_modal("认识新伙伴")
	_render_adoption(body)

func _adopt() -> void:
	if busy or not online:
		return
	var nickname: String = name_input.text.strip_edges()
	if nickname.is_empty():
		_set_status("为这次相遇取一个名字吧。")
		return
	var key: String = "adopt:" + selected_species + ":" + nickname
	var event: String = _event_for(key)
	var generation: int = account_generation
	busy = true
	_close_modal()
	_render()
	var result: Dictionary = await api.request("/pets", HTTPClient.METHOD_POST, {"species_id": selected_species, "nickname": nickname, "event_id": event})
	if generation != account_generation:
		return
	busy = false
	if result.get("ok", false):
		pending_actions.erase(key)
		var pet: Dictionary = result["data"]["pet"]
		_upsert_pet(pet)
		selected_pet = str(pet["id"])
		_set_status(L10n.t("%s 已经到家了。第一天，请多关照。") % str(pet["nickname"]))
	else:
		_set_status(API_SCRIPT.error_message(result))
		if int(result.get("http_status", 0)) >= 400 and int(result.get("http_status", 0)) < 500:
			pending_actions.erase(key)
	_render()

func _event_for(key: String) -> String:
	if not pending_actions.has(key):
		pending_actions[key] = API_SCRIPT.event_id()
	return str(pending_actions[key])

func _upsert_pet(pet: Dictionary) -> void:
	for i in range(pets.size()):
		if str(pets[i]["id"]) == str(pet["id"]):
			if int(pet.get("revision", 0)) < int(pets[i].get("revision", 0)):
				return
			pets[i] = pet
			pet_list_generation += 1
			return
	pets.append(pet)
	pet_list_generation += 1

func _care(action: String, choice: String = "") -> void:
	if busy or not online or current_pet().is_empty():
		return
	var pet: Dictionary = current_pet()
	var access_message: String = _pet_access_message(pet)
	if not access_message.is_empty():
		_set_status(access_message)
		return
	var generation: int = account_generation
	var key: String = str(pet["id"]) + ":" + action + ":" + choice
	var payload := {"action": action, "event_id": _event_for(key)}
	if not choice.is_empty():
		payload["choice"] = choice
	busy = true
	_set_status("正在记下这次陪伴……")
	_render()
	if _requires_wallet(pet):
		if not _send_bridge("care", {"pet_id": str(pet["id"]), "care": payload}, {"key": key, "action": action}):
			busy = false
			_render()
		return
	var result: Dictionary = await api.request("/pets/" + str(pet["id"]) + "/care", HTTPClient.METHOD_POST, payload)
	if generation != account_generation:
		return
	_finish_care(result, key, action)

func _finish_care(result: Dictionary, key: String, action: String) -> void:
	busy = false
	if result.get("ok", false):
		pending_actions.erase(key)
		_upsert_pet(result["data"]["pet"])
		var event: Dictionary = result["data"].get("event", {})
		_set_status(str(event.get("message_en" if L10n.lang == "en" else "message", event.get("message", "这次陪伴已经记住了。"))))
		_render()
		if is_instance_valid(pet_art) and event.get("applied", true):
			pet_art.celebrate(action)
	else:
		_set_status(API_SCRIPT.error_message(result))
		if int(result.get("http_status", 0)) >= 400 and int(result.get("http_status", 0)) < 500:
			pending_actions.erase(key)
		_render()

func _form_name(pet: Dictionary) -> String:
	var info: Dictionary = SPECIES.get(str(pet.get("species_id", "moss")), SPECIES["moss"])
	var form: String = str(pet.get("form", "seed"))
	return L10n.t("初遇 · ") + L10n.t(str(info["name"])) if form == "seed" else L10n.t(str(info.get(form, info["name"])))

func _chain_label(pet: Dictionary) -> String:
	match str(pet.get("chain", {}).get("status", "unregistered")):
		"registered": return L10n.t("已登记链上")
		"pending": return L10n.t("等待链上确认")
	return L10n.t("小屋伙伴")

func _render_collection() -> void:
	content.add_child(_label("每种模样，都有一段相处", 23))
	content.add_child(_label("3 种伙伴 · 6 条成长分支。灰色记录代表尚未拥有，预览不计入收藏。", 14, MUTED))
	var grid := GridContainer.new()
	grid.columns = 2 if small_layout else 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	content.add_child(grid)
	for species_id in SPECIES:
		for form in ["sun", "moon"]:
			var owned: bool = false
			for pet in pets:
				if pet.get("species_id") == species_id and pet.get("form") == form:
					owned = true
			var card := _panel(grid, Color("fffdf5") if owned else Color("efeee5"))
			var art := ART_SCRIPT.new()
			art.species = str(species_id)
			art.form = form
			art.show_habitat = false
			art.custom_minimum_size = Vector2(110, 125)
			if not owned:
				art.modulate.a = 0.45
			card.add_child(art)
			card.add_child(_label(str(SPECIES[species_id][form]), 16))
			card.add_child(_label("已经相遇" if owned else "尚未收集 · 成长预览", 12, MUTED))
	var tip := _panel(content, MINT)
	tip.add_child(_label("陪伴比稀有更珍贵", 19))
	tip.add_child(_label("日光与月色偏好影响成长。现阶段没有付费抽卡，也没有承诺收益；喜欢哪种，就陪它慢慢长成那种模样。", 14))
	_render_codex()

## P2: optional 120-entry design codex. Unreleased entries show only a silhouette + "Coming later" (03 §2), one family at a time.
func load_codex() -> Array:
	if codex_entries.is_empty():
		var file := FileAccess.open("res://data/codex.json", FileAccess.READ)
		if file != null:
			var parsed: Variant = JSON.parse_string(file.get_as_text())
			if parsed is Dictionary and parsed.get("entries") is Array:
				codex_entries = parsed["entries"]
	return codex_entries

func _render_codex() -> void:
	var entries: Array = load_codex()
	if entries.is_empty():
		return
	var toggle := _button(("收起图鉴总览" if codex_open else "浏览 120 图鉴总览"), func():
		codex_open = not codex_open
		_render())
	content.add_child(toggle)
	if not codex_open:
		return
	content.add_child(_label("设计目录：除现有 3 位伙伴外均为概念，尚未发行，只显示剪影。", 13, MUTED))
	var families := HFlowContainer.new()
	content.add_child(families)
	var seen: Dictionary = {}
	for entry in entries:
		var fam: Dictionary = entry.get("family", {})
		var n: int = int(fam.get("n", 0))
		if seen.has(n):
			continue
		seen[n] = true
		var label: String = str(fam.get("en", "")) if L10n.lang == "en" else str(fam.get("zh", ""))
		var chip := _button("%02d %s" % [n, label], func():
			codex_family = n
			_render())
		chip.disabled = n == codex_family
		families.add_child(chip)
	var grid := GridContainer.new()
	grid.columns = 3 if small_layout else 5
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	content.add_child(grid)
	for entry in entries:
		if int(entry.get("family", {}).get("n", 0)) != codex_family:
			continue
		var card := _panel(grid, Color("fffdf5") if bool(entry.get("available", false)) else Color("e4e2d8"))
		if bool(entry.get("available", false)) and entry.get("species_id") is String:
			var art := ART_SCRIPT.new()
			art.species = str(entry["species_id"])
			art.form = "seed"
			art.show_habitat = false
			art.custom_minimum_size = Vector2(72, 80)
			card.add_child(art)
			card.add_child(_label(L10n.pick(entry.get("name", {})), 13))
		else:
			var shadow := Label.new()
			shadow.text = "?"
			shadow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			shadow.custom_minimum_size = Vector2(72, 80)
			shadow.add_theme_font_size_override("font_size", 40)
			shadow.add_theme_color_override("font_color", Color("6b6a63"))
			card.add_child(shadow)
			card.add_child(_label("Coming later" if L10n.lang == "en" else "敬请期待", 12, MUTED))
		card.add_child(_label(str(entry.get("id", "")), 11, MUTED))

func _load_journal() -> void:
	var generation: int = account_generation
	var result: Dictionary = await api.request("/journal")
	if generation != account_generation:
		return
	if result.get("ok", false):
		journal = result["data"].get("entries", [])
	else:
		_set_status(API_SCRIPT.error_message(result))
	if page == "journal":
		_render()

func _render_journal() -> void:
	content.add_child(_label("一起度过的小日子", 23))
	content.add_child(_label("这些是实际发生的照顾记录。换一个名字，回忆也还在。", 14, MUTED))
	if journal.is_empty():
		var empty := _panel(content)
		empty.add_child(_label("第一篇日记，从相遇开始。", 19))
		empty.add_child(_label("领养一位伙伴，再喂它一口、陪它走走。服务保存的回忆会出现在这里。", 15, MUTED))
	else:
		for entry in journal.slice(0, 40):
			var card := _panel(content)
			card.add_child(_label(str(entry.get("created_at", "")).replace("T", " ").substr(0, 16) + " UTC", 12, MUTED))
			card.add_child(_label(str(entry.get("message", "")), 16))
	var refresh := _button("翻开最新一页", _load_journal)
	refresh.disabled = not online
	content.add_child(refresh)

func _render_trade() -> void:
	content.add_child(_label("让喜欢，遇见另一个喜欢", 23))
	content.add_child(_label("先一起生活，再决定是否把它变成可转让的链上宠物。", 14, MUTED))
	var card := _panel(content)
	var address: String = str(wallet.get("address", wallet.get("publicKey", "")))
	var connected: bool = not address.is_empty() and bool(wallet.get("connected", true))
	card.add_child(_label("钱包已连接" if connected else "你的钱包", 20))
	if connected:
		card.add_child(_label(address.left(8) + "…" + address.right(6), 14, MUTED))
	else:
		card.add_child(_label("小屋伙伴无需钱包。已登记的伙伴需验证钱包身份，日常照顾仍然免费。", 14, MUTED))
	var connect_button := _button("断开钱包" if connected else "连接钱包", func(): _send_bridge("disconnect" if connected else "connect"), true)
	connect_button.disabled = busy
	card.add_child(connect_button)
	var sync_button := _button("同步钱包里的伙伴", _sync_assets)
	sync_button.disabled = busy or not wallet.get("authenticated", false)
	card.add_child(sync_button)
	card.add_child(_label("同步本游戏已登记伙伴的最新归属；接收的伙伴不占免费领养名额。", 13, MUTED))
	var recover := _button("找回已有伙伴 / 切换档案", _open_recovery)
	recover.disabled = busy
	card.add_child(recover)
	card.add_child(_label("换设备后，用原来绑定的钱包找回伙伴。当前游客档案会保留在这台设备，不会自动合并。", 13, MUTED))
	if not api.previous_tokens.is_empty():
		var previous := _button("切回上一份本机档案", _restore_previous_profile)
		previous.disabled = busy
		card.add_child(previous)
	var enabled: bool = bool(chain_config.get("enabled", false))
	var market := _panel(content, Color("f0f1e5"))
	market.add_child(_label("链上登记与交换", 20))
	market.add_child(_label(L10n.t("网络：") + str(chain_config.get("network", "未配置")), 14, MUTED))
	if not enabled:
		market.add_child(_label("交易服务尚未开放", 18))
		market.add_child(_label("先免费领养，记录你们的日常。链上身份与交换开放后，你可以选择把伙伴带进钱包。", 15, MUTED))
	else:
		market.add_child(_label("登记和交易需要逐笔确认钱包。请核对宠物、对象与费用。", 14, MUTED))
	var registered: bool = current_pet().get("chain", {}).get("status", "unregistered") == "registered"
	var register := _button("保存成长到链上" if registered else "登记当前伙伴", func(): _send_bridge("checkpoint" if registered else "register", {"pet_id": str(current_pet().get("id", ""))}), true)
	register.disabled = busy or not enabled or current_pet().is_empty() or not connected or (registered and not _pet_access_message(current_pet()).is_empty())
	market.add_child(register)
	if registered:
		_render_gift(market, connected)
	var offers := _button("查看真实报价", func(): _send_bridge("offers"))
	offers.disabled = not bool(chain_config.get("market_enabled", false))
	market.add_child(offers)
	if not market_page.is_empty() and bool(chain_config.get("market_enabled", false)):
		_render_market_quotes()
	var explanation := _panel(content)
	explanation.add_child(_label("想换哪只，就换哪只", 19))
	explanation.add_child(_label("未来的交换将明确展示双方宠物，并由同一次链上结算完成交割。未成交时可按规则取回。所有权以确认后的链上记录为准。", 14, MUTED))

## P1 gift (Astra §5/§9). Returns "" when gifting is allowed, else the reason shown to the player.
func gift_block_reason(pet: Dictionary, connected: bool) -> String:
	if pet.is_empty() or pet.get("chain", {}).get("status", "") != "registered":
		return "只有已登记到链上的伙伴可以赠送。"
	if not connected or not bool(chain_config.get("enabled", false)):
		return "请先连接并验证钱包。"
	if str(travel.trips.get(str(pet.get("id", "")), {}).get("state", "")) == "travelling":
		return "伙伴正在旅行，回来后才能赠送。"
	if pet.get("ownership") is Dictionary and not bool(pet["ownership"].get("can_interact", true)):
		return "请先同步钱包，确认你仍拥有这位伙伴。"
	if gift_pending:
		return "赠送正在处理中……"
	return ""

func _render_gift(parent: VBoxContainer, connected: bool) -> void:
	var pet: Dictionary = current_pet()
	parent.add_child(_label("送给朋友", 18))
	parent.add_child(_label("输入接收者的 Solana 钱包地址。确认前会显示网络、资产、接收者和费用；私人日记与其他伙伴不会转移。", 13, MUTED))
	gift_input = LineEdit.new()
	gift_input.placeholder_text = L10n.t("接收者钱包地址")
	gift_input.text = gift_recipient
	gift_input.text_changed.connect(func(value: String): gift_recipient = value)
	parent.add_child(gift_input)
	var reason: String = gift_block_reason(pet, connected)
	var send := _button("作为礼物送出", _send_gift)
	send.disabled = busy or not reason.is_empty()
	parent.add_child(send)
	if not reason.is_empty():
		parent.add_child(_label(reason, 13, CORAL))

func _send_gift() -> void:
	var pet: Dictionary = current_pet()
	var recipient: String = gift_recipient.strip_edges()
	if not gift_block_reason(pet, true).is_empty() or recipient.is_empty():
		_set_status("请输入接收者钱包地址。" if recipient.is_empty() else gift_block_reason(pet, true))
		return
	gift_pending = true
	_set_status("请在钱包中核对赠送……")
	_render()
	var result: Dictionary = await _bridge_call("gift", {"pet_id": str(pet.get("id", "")), "recipient": recipient})
	gift_pending = false
	if not result.get("ok", false):
		_set_status(API_SCRIPT.error_message(result))
		_render()
		return
	var data: Dictionary = result.get("data", {})
	if str(data.get("state", "")) == "gifted":
		if data.get("pets") is Array:
			pets = data["pets"]
			pet_list_generation += 1
			selected_pet = str(current_pet().get("id", ""))
		gift_recipient = ""
		_set_status("礼物已在链上确认。接收者同步钱包后即可继续照顾。")
	else:
		_set_status("赠送已提交，正在等待确认。稍后同步钱包核对。")
	_render()

func _render_market_quotes() -> void:
	var heading := _panel(content)
	heading.add_child(_label("链上报价", 20))
	heading.add_child(_label("现在可以查看报价，暂未开放在游戏内成交。报价刷新后可能变化。", 14, MUTED))
	if bool(market_page.get("paused", false)):
		heading.add_child(_label("市场目前暂停成交。", 14, CORAL))
	var rows: Array = market_page.get("offers", [])
	if rows.is_empty():
		heading.add_child(_label("这一页暂时没有可展示的有效报价。", 15))
	for quote in rows:
		if not quote is Dictionary or not quote.get("pet") is Dictionary:
			continue
		var pet: Dictionary = quote["pet"]
		var card := _panel(content)
		var art := ART_SCRIPT.new()
		art.species = str(pet.get("species_id", "moss"))
		art.form = str(pet.get("form", "seed"))
		art.show_habitat = false
		art.custom_minimum_size = Vector2(100, 115)
		card.add_child(art)
		card.add_child(_label(_form_name(pet), 18))
		card.add_child(_label(L10n.t("亲密 %s · 成长记录 %s") % [str(pet.get("bond", 0)), str(pet.get("checkpoint", "0"))], 13, MUTED))
		if quote.get("kind", "") == "sale":
			card.add_child(_label(str(quote.get("price_sol", "—")) + " SOL", 21))
			card.add_child(_label(L10n.t("成交款内含市场费用 %s SOL；买方另付网络费用。") % str(quote.get("fee_sol", "—")), 13, MUTED))
		else:
			var wanted: Dictionary = quote.get("desired_pet", {})
			card.add_child(_label(L10n.t("希望交换：") + _form_name(wanted), 16))
			var wanted_address: String = str(wanted.get("asset_address", ""))
			card.add_child(_label(L10n.t("指定伙伴：") + wanted_address.left(8) + "…" + wanted_address.right(6), 13, MUTED))
		var asset: String = str(pet.get("asset_address", ""))
		card.add_child(_label(L10n.t("宠物：") + asset.left(8) + "…" + asset.right(6), 12, MUTED))
		if not bool(quote.get("can_settle", false)):
			card.add_child(_label("这条报价目前不能成交。", 14, CORAL))
	var rejected: Array = market_page.get("rejected", [])
	if not rejected.is_empty():
		heading.add_child(_label(L10n.t("本页有 %d 条已过期或未通过核对的报价，已隐藏。") % rejected.size(), 13, MUTED))
	if bool(market_page.get("has_more", false)):
		content.add_child(_button("查看下一页", func(): _send_bridge("offers", {"cursor": str(market_page.get("next_cursor", ""))})))

func _setup_bridge() -> void:
	if not OS.has_feature("web"):
		return
	bridge = JavaScriptBridge.get_interface("PetChainBridge")
	if bridge == null:
		return
	bridge_callback = JavaScriptBridge.create_callback(_on_bridge)
	bridge.subscribe(bridge_callback)

func _send_bridge(method: String, payload: Dictionary = {}, context: Dictionary = {}) -> bool:
	if bridge == null:
		if method not in ["set_session", "status"]:
			_set_status("请在网页版使用钱包。桌面版的浏览器配对尚未开放。")
		return false
	var request_id: String = API_SCRIPT.event_id()
	bridge_requests[request_id] = {"method": method, "generation": account_generation, "context": context}
	if method in ["connect", "recover", "register", "checkpoint"]:
		busy = true
		_render()
	bridge.request(JSON.stringify({"id": request_id, "method": method, "payload": payload}))
	return true

## Awaitable bridge call used by small components (travel). Late answers from an old profile are dropped by generation.
func _bridge_call(method: String, payload: Dictionary) -> Dictionary:
	if bridge == null:
		return {"ok": false, "error": {"code": "WALLET_UNSUPPORTED", "message": "请在网页版使用钱包。桌面版的浏览器配对尚未开放。"}}
	var request_id: String = API_SCRIPT.event_id()
	bridge_requests[request_id] = {"method": "await", "generation": account_generation}
	bridge.request(JSON.stringify({"id": request_id, "method": method, "payload": payload}))
	while true:
		var settled: Array = await bridge_settled
		if str(settled[0]) == request_id:
			return settled[1]
	return {}

func _on_bridge(arguments: Array) -> void:
	if arguments.is_empty():
		return
	var result: Variant = JSON.parse_string(str(arguments[0]))
	if not result is Dictionary:
		return
	var request_id: String = str(result.get("id", ""))
	var request: Dictionary = bridge_requests.get(request_id, {})
	bridge_requests.erase(request_id)
	if request.is_empty() and request_id != "wallet_changed":
		return
	if not request.is_empty() and int(request.get("generation", -1)) != account_generation:
		return
	var method: String = str(request.get("method", ""))
	var context: Dictionary = request.get("context", {})
	if method == "await":
		bridge_settled.emit(request_id, result)
		return
	if method == "care":
		_finish_care(result, str(context.get("key", "")), str(context.get("action", "")))
		return
	if method == "rename":
		_finish_rename(result)
		return
	if method in ["sync_assets", "connect", "recover", "register", "checkpoint"]:
		busy = false
	if not result.get("ok", false):
		_set_status(API_SCRIPT.error_message(result))
		_render()
		return
	var data: Variant = result.get("data", {})
	if data is Dictionary:
		if request_id == "wallet_changed":
			wallet = {"connected": data.get("connected", false), "authenticated": data.get("authenticated", false), "address": data.get("address", ""), "network": data.get("network", "")}
			_render()
			return
		if data.get("recovered", false):
			if request.get("method", "") != "recover" or str(data.get("game_token", "")).length() != 43:
				_set_status("档案恢复回应无效，原档案保持不变。")
				return
			if not api.save_token(str(data["game_token"]), true):
				_send_bridge("disconnect")
				if not api.token.is_empty():
					_send_bridge("set_session", {"token": api.token})
				_set_status("无法保存恢复后的档案，原档案保持不变。请检查浏览器存储或磁盘空间。")
				return
			_switch_profile()
			wallet = data.duplicate()
			wallet.erase("game_token")
			if not testing:
				_boot()
			return
		if data.has("connected") or data.has("address") or data.has("publicKey"):
			wallet = data
		if data.has("chain_enabled"):
			chain_config["enabled"] = bool(data["chain_enabled"])
		if data.has("market_enabled"):
			chain_config["market_enabled"] = bool(data["market_enabled"])
		if data.get("offers") is Array:
			market_page = data
			_set_status("已核对当前页的链上报价。")
		if data.get("pet") is Dictionary:
			_upsert_pet(data["pet"])
		if method == "sync_assets" and data.get("pets") is Array:
			pets = data["pets"]
			pet_list_generation += 1
			selected_pet = str(current_pet().get("id", ""))
			var unavailable: int = int(data.get("ownership", {}).get("unavailable", 0))
			_set_status(L10n.t("伙伴已同步；还有 %d 份归属暂未能确认，请稍后重试。") % unavailable if unavailable > 0 else "伙伴归属已同步，可以继续你们的日常了。")
			_render()
		if data.get("state", "") == "confirmed" and not testing:
			_sync_assets()
		if data.has("message"):
			var bridge_message: String = str(data["message"])
			if L10n.lang == "en" and L10n._has_cjk(bridge_message):
				bridge_message = "Confirmed on Solana." if str(data.get("state", "")) == "confirmed" else ("Submitted · checking confirmation" if str(data.get("state", "")) in ["submitted", "pending", "signed", "prepared"] else "Wallet request finished. Check the result above.")
			_set_status(bridge_message)
	if page == "trade":
		_render()
	if method == "connect" and wallet.get("authenticated", false) and not testing:
		_sync_assets()

func _sync_assets() -> void:
	if busy or not wallet.get("authenticated", false):
		return
	busy = true
	_set_status("正在核对钱包伙伴的最新归属……")
	if not _send_bridge("sync_assets"):
		busy = false
	_render()

func _refresh_chain_pet() -> void:
	var generation: int = account_generation
	var list_generation: int = pet_list_generation
	var result: Dictionary = await api.request("/pets")
	if generation != account_generation or list_generation != pet_list_generation:
		return
	if result.get("ok", false):
		pets = result.get("data", {}).get("pets", [])
		pet_list_generation += 1
		selected_pet = str(current_pet().get("id", ""))
		_render()

func _open_recovery() -> void:
	if busy:
		return
	var body := _open_modal("找回已有伙伴")
	body.add_child(_label("请使用之前绑定的钱包。验证后打开原来的宠物档案；当前游客伙伴不会被合并或删除，你可以在这台设备切回。", 15))
	body.add_child(_label("首次使用钱包时，请先关闭这个窗口，选择「连接钱包」来绑定当前伙伴。", 13, MUTED))
	body.add_child(_button("用原钱包找回", func():
		_close_modal()
		_send_bridge("recover"), true))

func _switch_profile() -> void:
	account_generation += 1
	boot_generation += 1
	pet_list_generation += 1
	pets.clear()
	journal.clear()
	market_page.clear()
	pending_actions.clear()
	travel.reset()
	selected_pet = ""
	wallet.clear()
	busy = false
	online = false
	_close_modal()
	_set_status("正在打开这份伙伴档案……")
	_render()

func _restore_previous_profile() -> void:
	if busy or api.previous_tokens.is_empty():
		return
	if not api.restore_previous_session():
		_set_status("无法保存档案切换，原档案保持不变。请检查浏览器存储或磁盘空间。")
		return
	_send_bridge("disconnect")
	_switch_profile()
	_send_bridge("set_session", {"token": api.token})
	if not testing:
		_boot()

func _open_modal(title: String) -> VBoxContainer:
	_close_modal()
	modal = Control.new()
	modal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(modal)
	var shade := ColorRect.new()
	shade.color = Color(0.13, 0.20, 0.18, 0.65)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	modal.add_child(shade)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 14 if small_layout else maxi(24, int(size.x * 0.2)))
	for side in ["top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 18)
	modal.add_child(margin)
	var center := VBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	margin.add_child(center)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	center.add_child(scroll)
	var body := _panel(scroll, CREAM)
	body.add_child(_label(title, 22))
	body.add_child(_button("返回小屋", _close_modal))
	return body

func _close_modal() -> void:
	if is_instance_valid(modal):
		remove_child(modal)
		modal.queue_free()
	modal = null

func _open_rename() -> void:
	if busy or not _pet_access_message(current_pet()).is_empty():
		return
	var body := _open_modal("一个只属于它的名字")
	name_input = LineEdit.new()
	name_input.text = str(current_pet().get("nickname", ""))
	name_input.max_length = 16
	name_input.custom_minimum_size.y = 45
	body.add_child(name_input)
	body.add_child(_button("记住这个名字", _rename, true))

func _rename() -> void:
	if busy or not online or current_pet().is_empty() or not _pet_access_message(current_pet()).is_empty():
		return
	var nickname: String = name_input.text.strip_edges()
	if nickname.is_empty():
		_set_status("名字还空着呢。")
		return
	busy = true
	var pet_id: String = str(current_pet().get("id", ""))
	var generation: int = account_generation
	_close_modal()
	_render()
	if _requires_wallet(current_pet()):
		if not _send_bridge("rename", {"pet_id": pet_id, "nickname": nickname}):
			busy = false
			_render()
		return
	var result: Dictionary = await api.request("/pets/" + pet_id, HTTPClient.METHOD_PATCH, {"nickname": nickname})
	if generation != account_generation:
		return
	_finish_rename(result)

func _finish_rename(result: Dictionary) -> void:
	busy = false
	if result.get("ok", false):
		_upsert_pet(result["data"]["pet"])
		_set_status(L10n.t("它记住了这个新名字：") + str(result["data"]["pet"].get("nickname", "")))
	else:
		_set_status(API_SCRIPT.error_message(result))
	_render()

func _open_adventure() -> void:
	if busy or not online or current_pet().is_empty() or not _pet_access_message(current_pet()).is_empty():
		return
	var body := _open_modal("今天，想走哪条小路？")
	body.add_child(_label("找到三片记忆碎片，一起带回家。走过的路线会影响伙伴的日光或月色偏好。", 15, MUTED))
	body.add_child(_button("沿着日光，去草地散步", _start_adventure.bind("sun"), true))
	body.add_child(_button("循着月色，听风的声音", _start_adventure.bind("moon")))

func _start_adventure(choice: String) -> void:
	adventure_choice = choice
	adventure_count = 0
	var body := _open_modal("日光草地" if choice == "sun" else "月色小径")
	body.add_child(_label("轻点记忆碎片，把今晚的风声和星光一起带回家。" if choice == "moon" else "轻点记忆碎片，把今天的暖风和阳光一起带回家。", 14, MUTED))
	adventure_field = Control.new()
	adventure_field.custom_minimum_size.y = 300
	body.add_child(adventure_field)
	var art := ART_SCRIPT.new()
	art.species = str(current_pet().get("species_id", "moss"))
	art.form = str(current_pet().get("form", "seed"))
	art.habitat = choice
	art.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	adventure_field.add_child(art)
	_add_memory_fragment()

func _add_memory_fragment() -> void:
	if not is_instance_valid(adventure_field):
		return
	var fragment := _button(L10n.t("记忆 %d / 3") % (adventure_count + 1), _collect_memory, true)
	fragment.name = "MemoryFragment"
	fragment.set_anchors_preset(Control.PRESET_TOP_LEFT)
	fragment.anchor_left = [0.08, 0.55, 0.30][adventure_count]
	fragment.anchor_top = [0.12, 0.58, 0.23][adventure_count]
	fragment.position = Vector2.ZERO
	fragment.custom_minimum_size = Vector2(110, 48)
	adventure_field.add_child(fragment)
	fragment.grab_focus()

func _collect_memory() -> void:
	var fragment: Node = adventure_field.get_node_or_null("MemoryFragment")
	if fragment == null:
		return
	adventure_field.remove_child(fragment)
	fragment.queue_free()
	adventure_count += 1
	if adventure_count >= 3:
		_close_modal()
		_care("explore", adventure_choice)
	else:
		_add_memory_fragment()

func _unhandled_key_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") and is_instance_valid(modal):
		_close_modal()
		get_viewport().set_input_as_handled()
