extends SceneTree

const API_SCRIPT = preload("res://scripts/api_client.gd")
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
	if not "--session-storage-test" in OS.get_cmdline_user_args():
		push_error("Run with -- --session-storage-test; storage tests use only a new isolated directory.")
		quit(2)
		return
	var directory: String = OS.get_cache_dir().path_join("pixelpets-session-test-" + API_SCRIPT.event_id())
	if DirAccess.make_dir_absolute(directory) != OK:
		push_error("Cannot create an isolated storage test directory.")
		quit(2)
		return
	var path: String = directory.path_join("session.cfg")
	var api := API_SCRIPT.new()
	api.session_path = path
	api._ready()
	check(api.token.is_empty() and api.previous_tokens.is_empty(), "A fresh isolated session has no player credentials")
	var first: String = "a".repeat(43)
	var second: String = "b".repeat(43)
	var third: String = "c".repeat(43)
	check(api.save_token(first), "First credential save succeeds")
	check(FileAccess.file_exists(path), "First save creates the configured isolated file")
	check(api.save_token(second, true), "Recovery atomically replaces an existing session file")
	check(api.token == second and api.previous_tokens == PackedStringArray([first]), "Successful recovery commits the new credential and archive together")
	var reloaded := API_SCRIPT.new()
	reloaded.session_path = path
	reloaded._ready()
	check(reloaded.token == second and reloaded.previous_tokens == PackedStringArray([first]), "A fresh client reloads both persisted profiles")
	check(reloaded.restore_previous_session(), "Restoring a profile saves the new active and archived credentials together")
	check(reloaded.token == first and reloaded.previous_tokens == PackedStringArray([second]), "Restoring preserves the recovered profile in the archive")
	var saved_bytes: PackedByteArray = FileAccess.get_file_as_bytes(path)
	check(not reloaded.save_token("invalid\ncredential", true), "Malformed credentials cannot replace local storage")
	check(reloaded.last_storage_error == ERR_INVALID_DATA, "A malformed credential reports its storage error")
	check(reloaded.token == first and reloaded.previous_tokens == PackedStringArray([second]), "Rejected credential input preserves in-memory state")
	check(FileAccess.get_file_as_bytes(path) == saved_bytes, "Rejected credential input preserves the old file byte for byte")
	reloaded.session_path = directory.path_join("missing/session.cfg")
	check(not reloaded.save_token(third, true), "A failed file write is returned to the caller")
	check(reloaded.last_storage_error != OK, "A failed file write exposes an error code")
	check(reloaded.token == first and reloaded.previous_tokens == PackedStringArray([second]), "A failed recovery write leaves the active credential and history unchanged")
	check(not reloaded.restore_previous_session(), "A failed restore write is returned to the caller")
	check(reloaded.token == first and reloaded.previous_tokens == PackedStringArray([second]), "A failed restore does not rotate or drop an archived credential")
	check(FileAccess.get_file_as_bytes(path) == saved_bytes, "Failed writes leave the existing valid session file unchanged")
	var blocked: String = directory.path_join("replacement-blocked")
	check(DirAccess.make_dir_absolute(blocked) == OK, "The atomic-replacement failure fixture is isolated")
	reloaded.session_path = blocked
	check(not reloaded.save_token(third, true), "A failed atomic rename cannot report a successful recovery")
	check(reloaded.token == first and reloaded.previous_tokens == PackedStringArray([second]), "A failed atomic rename leaves both in-memory credentials intact")
	check(DirAccess.dir_exists_absolute(blocked) and FileAccess.get_file_as_bytes(path) == saved_bytes, "A failed atomic rename never deletes its destination or the old session")
	check(DirAccess.get_files_at(directory).size() == 1, "Failed writes and replacements remove only their own temporary file")
	reloaded.session_path = path
	check(reloaded.save_token(""), "Clearing an expired active credential can be persisted")
	check(reloaded.token.is_empty() and reloaded.previous_tokens == PackedStringArray([second]), "Clearing an active credential retains other local profiles")
	var cleared := API_SCRIPT.new()
	cleared.session_path = path
	cleared._ready()
	check(cleared.token.is_empty() and cleared.previous_tokens == PackedStringArray([second]), "A fresh client reloads the cleared active credential and preserved archive")
	api.free()
	reloaded.free()
	cleared.free()
	# The random directory and its two entries were created by this test; no recursive removal is needed.
	DirAccess.remove_absolute(path)
	DirAccess.remove_absolute(blocked)
	DirAccess.remove_absolute(directory)
	print("PixelPets session storage: %d checks, %d failures" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
