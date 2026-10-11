extends SceneTree
## Complete six-light interaction, server cooldown, archived postcards, and profile isolation.
class MockAPI extends PetAPI:
	signal released
	var replies: Array = []
	var calls: Array = []
	var paused: bool = false
	func request(path: String, _method: HTTPClient.Method = HTTPClient.METHOD_GET, _payload: Dictionary = {}) -> Dictionary:
		calls.append(path)
		var result: Dictionary = replies.pop_front() if not replies.is_empty() else {"ok": false}
		if paused:
			paused = false
			await released
		return result

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
	viewport.size = Vector2i(320, 800)
	root.add_child(viewport)
	var client = load("res://main.tscn").instantiate()
	viewport.add_child(client)
	await process_frame
	check(client.FONT.has_char("★".unicode_at(0)), "The mini-game star exists in the bundled font")
	check(client.sound_button.text == "ON", "Sound starts with a readable control")
	client._toggle_sound()
	check(not client.sounds.enabled and client.sound_button.text == "OFF", "The mute button disables sound")
	client._toggle_sound()
	client.api.queue_free()
	var api := MockAPI.new()
	api.test_mode = true
	client.add_child(api)
	client.api = api
	client.online = true
	var pet := {"id": "my-pet", "species_id": "moss", "nickname": "Clover", "form": "seed", "bond": 1, "care_count": 1, "revision": 1}
	client.pets = [pet]
	client.selected_pet = "my-pet"
	client._start_adventure("moon")
	for index in range(6):
		await process_frame
		await process_frame
		var star: Button = client.adventure_field.get_node_or_null("MemoryFragment")
		check(star != null and star.get_global_rect().end.x <= 320, "Memory light %d fits a 320 px viewport" % index)
		check(api.calls.is_empty(), "Collecting a partial set creates no server care event")
		client._collect_memory()
	check(client.adventure_count == 6 and api.calls.size() == 1, "Six collected lights submit exactly one care event")
	check(pet.get("bond") == 1, "The mini-game cannot award growth locally")
	var now: float = Time.get_unix_time_from_system() * 1000.0
	var result := {"ok": true, "data": {"pet": pet, "event": {"message_en": "A warm moment", "applied": true,
		"server_time": Time.get_datetime_string_from_unix_time(int(now / 1000)) + "Z",
		"next_allowed_at": Time.get_datetime_string_from_unix_time(int(now / 1000) + 12) + "Z"}}}
	client._finish_care(result, "care", "feed")
	check(client._care_remaining() in [11, 12], "A confirmed care response starts the server cooldown")
	var blocked: int = 0
	for button in client.content.find_children("*", "Button", true, false):
		if button.text in ["Feed", "Play", "Rest", "Short walk"] and button.disabled:
			blocked += 1
	check(blocked == 4, "All four care actions explain their waiting period consistently")
	client.care_deadlines["my-pet"] = Time.get_ticks_msec() - 1
	client._tick_care()
	check(client._care_remaining() == 0 and not client.care_deadlines.has("my-pet"), "Expired cooldown unlocks without another HTTP request")
	var postcard := {"id": "old-trip", "pet_id": "my-pet", "state": "revealed", "route_id": "moonlit_lane", "settled_at": "2026-10-11T00:00:00Z",
		"result": {"items": [{"id": "last_lantern", "rarity": "special", "name": {"en": "The Last Lantern"}}], "story": {"en": {"title": "A quiet journey", "lines": ["We saw a meteor."]}}}}
	api.replies = [{"ok": true, "data": {"trips": [postcard, {"state": "travelling"}]}}]
	await client.travel.refresh_album()
	check(client.travel.postcards.size() == 1, "Only opened postcards appear in the album")
	client.travel.open_postcard(postcard)
	await process_frame
	check(is_instance_valid(client.modal) and client.modal.find_children("*", "KeepsakeArt", true, false).size() == 1, "An archived postcard reopens with its keepsake illustration")
	client._close_modal()
	client._open_help()
	viewport.size = Vector2i(1000, 800)
	client.size = Vector2(1000, 800)
	await process_frame
	viewport.size = Vector2i(320, 800)
	client.size = Vector2(320, 800)
	await process_frame
	await process_frame
	check(client.modal_margin.get_combined_minimum_size().x <= 320, "Open dialogs adapt when the viewport changes from desktop to phone")
	client._close_modal()
	api.replies = [{"ok": false, "error": {"code": "CONNECTION"}}]
	await client.travel.refresh_album()
	check(not client.travel.album_error.is_empty() and client.travel.postcards.size() == 1, "A network error preserves already loaded postcards")
	api.replies = [{"ok": true, "data": {"trips": [postcard]}}]
	api.paused = true
	client.travel.refresh_album()
	client._switch_profile()
	api.released.emit()
	await process_frame
	check(client.travel.postcards.is_empty() and client.care_deadlines.is_empty(), "Late responses and cooldowns cannot cross profiles")
	viewport.queue_free()
	await process_frame
	print("PixelPets product: %d checks, %d failures" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
