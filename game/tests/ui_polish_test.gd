extends SceneTree

var checks: int = 0
var failures: Array[String] = []

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		push_error(message)

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	if not "--client-test" in OS.get_cmdline_user_args():
		quit(2)
		return
	var viewport := SubViewport.new()
	viewport.size = Vector2i(360, 640)
	root.add_child(viewport)
	var client = load("res://main.tscn").instantiate()
	viewport.add_child(client)
	await process_frame
	client.online = true
	client.pets = [
		{"id": "first", "nickname": "ABCDEFGHIJKLMNOP", "species_id": "moss", "form": "seed"},
		{"id": "second", "nickname": "Wisp", "species_id": "wisp", "form": "moon"}
	]
	client.selected_pet = "first"
	client.travel.catalog = {"routes": [], "packings": []}
	client.travel.collections = {"discovered": 0, "total": 8, "collectibles": []}
	client.travel.trips = {"first": {}, "second": {}}
	client.travel.loaded_generation = client.account_generation
	for language in ["en", "zh"]:
		client._set_language(language)
		for dimensions in [Vector2i(320, 640), Vector2i(360, 640), Vector2i(768, 900), Vector2i(1440, 900)]:
			viewport.size = dimensions
			client.size = Vector2(dimensions)
			await process_frame
			for next_page in ["companion", "travel", "trade", "collection", "journal"]:
				client.page = next_page
				client._render()
				await process_frame
				await process_frame
				check(client.content.get_combined_minimum_size().x <= dimensions.x - 36,
					"%s %s fits %d px; got %f" % [language, next_page, dimensions.x, client.content.get_combined_minimum_size().x])
				if next_page in ["companion", "travel", "trade"]:
					check(client.content.find_children("CompanionSelector", "OptionButton", true, false).size() == 1,
						"%s offers exactly one companion selector" % next_page)
	client.online = false # Selection in this fixture must never call a live server.
	client.page = "travel"
	client._select_pet("second")
	check(client.current_pet().get("id") == "second" and client.page == "travel", "Switching companion preserves the current page")
	client.busy = true
	client._select_pet("first")
	check(client.selected_pet == "second", "A companion cannot change during an active care or wallet action")
	client.busy = false
	client._select_pet("not-owned")
	check(client.selected_pet == "second", "Unknown pet IDs cannot become the selection")
	client.pets.clear()
	client.page = "companion"
	client._render()
	client.name_input.text = "My companion"
	client._choose_species("puddle")
	check(client.name_input.text == "My companion", "Choosing another species preserves a custom nickname")
	client.name_input.text_changed.emit("My companion")
	client._set_language("en")
	check(client.name_input.text == "My companion" and not L10n._has_cjk(client.name_input.placeholder_text), "Language changes preserve the nickname and translate its placeholder")
	viewport.queue_free()
	await process_frame
	print("PixelPets UI polish: %d checks, %d failures" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
