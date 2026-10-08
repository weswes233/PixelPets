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
	var api = load("res://scripts/api_client.gd").new()
	root.add_child(api)
	# Use a fresh test guest without persisting its token over a player's session.
	api.token = ""
	var guest: Dictionary = await api.request("/guests", HTTPClient.METHOD_POST)
	check(guest.get("ok", false), "A real HTTP guest is created")
	if not guest.get("ok", false):
		api.queue_free()
		await process_frame
		quit(1)
		return
	api.token = str(guest["data"]["token"])
	var catalog: Dictionary = await api.request("/catalog")
	check(catalog.get("ok", false) and catalog.get("data", {}).get("species", []).size() == 3, "The HTTP catalog contains three species")
	var event: String = api.event_id()
	var adoption := {"species_id": "moss", "nickname": "客户端验收伙伴", "event_id": event}
	var adopted: Dictionary = await api.request("/pets", HTTPClient.METHOD_POST, adoption)
	check(adopted.get("ok", false), "A real pet can be adopted")
	if not adopted.get("ok", false):
		api.queue_free()
		await process_frame
		quit(1)
		return
	var pet: Dictionary = adopted["data"]["pet"]
	var replay: Dictionary = await api.request("/pets", HTTPClient.METHOD_POST, adoption)
	check(replay.get("data", {}).get("pet", {}).get("id") == pet["id"], "An HTTP adoption retry returns the same pet")
	var action := {"action": "explore", "choice": "moon", "event_id": api.event_id()}
	var care: Dictionary = await api.request("/pets/" + str(pet["id"]) + "/care", HTTPClient.METHOD_POST, action)
	check(care.get("ok", false) and care.get("data", {}).get("event", {}).get("applied", false), "HTTP exploration is accepted by the server")
	check(care.get("data", {}).get("pet", {}).get("bond") == 1, "The authoritative bond increases once")
	var repeated: Dictionary = await api.request("/pets/" + str(pet["id"]) + "/care", HTTPClient.METHOD_POST, action)
	check(repeated.get("data", {}).get("pet", {}).get("bond") == 1, "Repeating the same HTTP event does not award twice")
	var renamed: Dictionary = await api.request("/pets/" + str(pet["id"]), HTTPClient.METHOD_PATCH, {"nickname": "月光伙伴"})
	check(renamed.get("ok", false) and renamed.get("data", {}).get("pet", {}).get("nickname") == "月光伙伴", "Renaming persists through the service")
	var listing: Dictionary = await api.request("/pets")
	check(listing.get("data", {}).get("pets", []).size() == 1, "Refreshing still returns only the single adopted pet")
	var diary: Dictionary = await api.request("/journal")
	check(diary.get("ok", false) and not diary.get("data", {}).get("entries", []).is_empty(), "Server journal records the real interactions")
	var config: Dictionary = await api.request("/chain/config")
	check(config.get("ok", false) and not config.get("data", {}).get("enabled", true), "Unconfigured chain fails closed across HTTP")
	api.queue_free()
	await process_frame
	print("PixelPets HTTP client: %d checks, %d failures" % [checks, failures.size()])
	quit(0 if failures.is_empty() else 1)
