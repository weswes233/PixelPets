extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if not "--client-test" in args:
		push_error("Preview requires -- --client-test so it cannot open a player session.")
		quit(2)
		return
	var client = load("res://main.tscn").instantiate()
	root.add_child(client)
	await process_frame
	client.online = true
	client._set_language("zh" if "--preview-zh" in args else "en")
	var kind: String = "adoption"
	if "--preview-pet" in args or "--preview-collection" in args or "--preview-travel" in args:
		# Visual fixture only; never persisted and not used in the release application.
		client.pets = [{"id": "visual-fixture", "species_id": "moss", "nickname": "小栗" if L10n.lang == "zh" else "Clover", "form": "moon", "bond": 6, "energy": 80, "mood": 90, "chain": {"status": "unregistered"}},
			{"id": "second-fixture", "species_id": "wisp", "nickname": "微光" if L10n.lang == "zh" else "Wisp", "form": "seed", "bond": 1, "energy": 70, "mood": 80}]
		client.selected_pet = "visual-fixture"
		kind = "collection" if "--preview-collection" in args else "companion"
		client.page = kind
		if "--preview-travel" in args:
			kind = "travel"
			client.page = kind
			client.travel.catalog = {"demo": {"duration_ms": 45000}, "routes": [
				{"id": "sunny_market", "name": {"en": "Sunny Market", "zh": "阳光集市"}, "blurb": {"en": "Warm stones, a little bakery, and a market full of tiny stories.", "zh": "暖暖的石板路、小小的面包铺，还有集市里的新鲜故事。"}},
				{"id": "moonlit_lane", "name": {"en": "Moonlit Lantern Lane", "zh": "月灯小径"}}],
				"packings": [{"id": "snack_tin", "name": {"en": "Snack tin", "zh": "点心盒"}}, {"id": "tiny_lantern", "name": {"en": "Tiny lantern", "zh": "小提灯"}}]}
			client.travel.supplies = {"balance": 3, "daily_cap": 3}
			client.travel.collections = {"total": 8, "discovered": 0, "collectibles": []}
			client.travel.trips = {"visual-fixture": {}, "second-fixture": {}}
			client.travel.loaded_generation = client.account_generation
	client._set_status("视觉验收使用临时测试数据，不代表实际游戏存档。" if L10n.lang == "zh" else "Visual fixture only. This is not a player save.")
	client._render()
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	var preview := root.get_texture().get_image()
	var output: String = "res://tests/preview-%s-%d.png" % [kind, root.size.x]
	for arg in args:
		if arg.begins_with("--preview-output="):
			output = arg.trim_prefix("--preview-output=")
	var result: Error = preview.save_png(output)
	print("Saved visual fixture: " + output)
	client.queue_free()
	await process_frame
	quit(0 if result == OK else 1)
