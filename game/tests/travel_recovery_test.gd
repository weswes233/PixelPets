extends SceneTree
## Regressions for failed loads, selection during HTTP, and profile changes during HTTP.

class MockAPI extends PetAPI:
	signal released
	var replies: Array = []
	var calls: PackedStringArray = []
	var pause_next: bool = false

	func request(path: String, _method: HTTPClient.Method = HTTPClient.METHOD_GET, _payload: Dictionary = {}) -> Dictionary:
		calls.append(path)
		var response: Dictionary = replies.pop_front()
		if pause_next:
			pause_next = false
			await released
		return response

var checks: int = 0
var failures: Array[String] = []

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		push_error(message)

func _initialize() -> void:
	call_deferred("run")

func ok(data: Dictionary) -> Dictionary:
	return {"ok": true, "data": data}

func run() -> void:
	if not "--client-test" in OS.get_cmdline_user_args():
		quit(2)
		return
	var client = load("res://main.tscn").instantiate()
	root.add_child(client)
	await process_frame
	client.api.queue_free()
	var api := MockAPI.new()
	api.test_mode = true
	client.add_child(api)
	client.api = api
	client.online = true
	client.page = "travel"
	client.pets = [
		{"id": "first", "nickname": "Moss", "species_id": "moss", "chain": {"status": "unregistered"}},
		{"id": "second", "nickname": "Wisp", "species_id": "wisp", "chain": {"status": "unregistered"}}
	]
	client.selected_pet = "first"
	var view: TravelView = client.travel
	var catalog := {"routes": [], "packings": [], "demo": {"duration_ms": 45000}}
	var collections := {"discovered": 0, "total": 8, "collectibles": []}
	var current := {"trip": null, "supplies": {"balance": 3, "daily_cap": 3}}
	api.replies = [{"ok": false, "error": {"code": "CONNECTION"}}, ok(collections), ok(current)]
	await view.refresh(true)
	check(not view.last_error.is_empty() and view.loaded_generation == -1, "A failed load is not marked complete")
	var retry: Button = null
	for button in client.content.find_children("*", "Button", true, false):
		if button.text == "Try again":
			retry = button
	check(retry != null and not retry.disabled, "Failure offers an enabled retry instead of endless loading")
	check(api.calls.size() == 3, "Rendering a failure does not cause a request loop")
	api.replies = [ok(catalog), ok(collections), ok(current)]
	await view.refresh(true)
	check(view.last_error.is_empty() and view.loaded_generation == client.account_generation, "Retry loads authoritative data")
	check(view.trips.has("first") and view.trips["first"].is_empty(), "Only a successful null trip is treated as idle")

	# A request started for Moss must keep that identity even when Wisp is selected before it completes.
	api.calls.clear()
	api.replies = [ok(catalog), ok(collections), ok(current), ok(catalog), ok(collections),
		ok({"trip": {"id": "second-trip", "pet_id": "second", "state": "travelling", "ready_at": "2099-01-01T00:00:00Z"}, "supplies": {"balance": 2}})]
	api.pause_next = true
	view.refresh(true)
	client._select_pet("second")
	check(view.refresh_queued, "Selection during HTTP queues the new companion's lookup")
	api.released.emit()
	await process_frame
	check(api.calls.has("/pets/first/trips/current") and api.calls.has("/pets/second/trips/current"), "Each companion gets its own trip lookup")
	check(view.trips["first"].is_empty() and view.trips["second"].get("id") == "second-trip", "Responses cannot attach another companion's trip")
	check(client.selected_pet == "second" and not view.loading, "Selection survives the completed requests")

	# Invalidating an in-flight profile must immediately permit loading the new profile.
	api.pause_next = true
	api.replies = [ok({"stale": true})]
	view.refresh(true)
	client._switch_profile()
	check(not view.loading and view.last_error.is_empty(), "Profile reset releases the loading state")
	client.online = true
	client.pets = [{"id": "new-profile", "nickname": "New", "species_id": "puddle"}]
	client.selected_pet = "new-profile"
	api.replies = [ok(catalog), ok(collections), ok(current)]
	await view.refresh(true)
	api.released.emit()
	await process_frame
	check(not view.catalog.has("stale") and view.trips.has("new-profile"), "Late previous-profile HTTP cannot overwrite the new profile")
	check(not view.trips.has("first") and not view.trips.has("second"), "Previous profile's trips remain cleared")
	client.queue_free()
	await process_frame
	print("PixelPets travel recovery: %d checks, %d failures" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
