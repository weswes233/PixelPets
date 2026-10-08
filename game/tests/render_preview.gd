extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var client = load("res://main.tscn").instantiate()
	root.add_child(client)
	await process_frame
	client.online = true
	var args: PackedStringArray = OS.get_cmdline_user_args()
	var kind: String = "adoption"
	if "--preview-pet" in args or "--preview-collection" in args:
		# Visual fixture only; never persisted and not used in the release application.
		client.pets = [{"id": "visual-fixture", "species_id": "moss", "nickname": "小栗", "form": "moon", "bond": 6, "energy": 80, "mood": 90, "chain": {"status": "unregistered"}}]
		client.selected_pet = "visual-fixture"
		kind = "collection" if "--preview-collection" in args else "companion"
		client.page = kind
	client._set_status("视觉验收使用临时测试数据，不代表实际游戏存档。")
	client._render()
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	var preview := root.get_texture().get_image()
	var output: String = "res://tests/preview-%s-%d.png" % [kind, root.size.x]
	var result: Error = preview.save_png(output)
	print("Saved visual fixture: " + output)
	client.queue_free()
	await process_frame
	quit(0 if result == OK else 1)
