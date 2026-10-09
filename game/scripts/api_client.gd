extends Node
class_name PetAPI

var base_url: String = ""
var token: String = ""
var test_mode: bool = false
var previous_tokens: PackedStringArray = []
var session_path: String = "user://session.cfg"
var last_storage_error: Error = OK

func _ready() -> void:
	base_url = str(ProjectSettings.get_setting("pixelpets/api_url", "http://127.0.0.1:9782"))
	if OS.has_feature("web"):
		var browser_window := JavaScriptBridge.get_interface("window")
		base_url = str(browser_window.location.origin)
	var configured: String = OS.get_environment("PIXELPETS_API_URL")
	if not configured.is_empty():
		base_url = configured.trim_suffix("/")
	if test_mode:
		return
	var session := ConfigFile.new()
	if session.load(session_path) == OK:
		var saved_token: Variant = session.get_value("guest", "token", "")
		if saved_token is String and _valid_token(saved_token):
			token = saved_token
		var saved: Variant = session.get_value("guest", "previous_tokens", PackedStringArray())
		if saved is Array or saved is PackedStringArray:
			for value in saved:
				if value is String and not value.is_empty() and _valid_token(value) and value != token and not previous_tokens.has(value):
					previous_tokens.append(value)

static func event_id() -> String:
	return Crypto.new().generate_random_bytes(16).hex_encode()

static func _valid_token(value: String) -> bool:
	if value.is_empty():
		return true
	if value.length() != 43:
		return false
	for character in value:
		if not character in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-":
			return false
	return true

func save_token(value: String, remember_current: bool = false) -> bool:
	if not _valid_token(value):
		last_storage_error = ERR_INVALID_DATA
		return false
	var staged: PackedStringArray = previous_tokens.duplicate()
	if remember_current and not token.is_empty() and token != value and not staged.has(token):
		staged.insert(0, token)
	var existing: int = staged.find(value)
	if existing >= 0:
		staged.remove_at(existing)
	return _commit_session(value, staged)

func _commit_session(value: String, history: PackedStringArray) -> bool:
	last_storage_error = OK
	if not test_mode:
		var session := ConfigFile.new()
		session.set_value("guest", "token", value)
		session.set_value("guest", "previous_tokens", history)
		var destination: String = ProjectSettings.globalize_path(session_path)
		var temporary: String = destination + "." + event_id() + ".tmp"
		last_storage_error = session.save(temporary)
		if last_storage_error == OK:
			var verified := ConfigFile.new()
			last_storage_error = verified.load(temporary)
			if last_storage_error == OK and (verified.get_value("guest", "token", null) != value or verified.get_value("guest", "previous_tokens", null) != history):
				last_storage_error = ERR_FILE_CORRUPT
		if last_storage_error == OK:
			# The same-directory rename must replace atomically. Never delete the old credential first.
			# Web builds write a virtual filesystem here; durable IndexedDB synchronization is separate.
			last_storage_error = DirAccess.rename_absolute(temporary, destination)
		if last_storage_error != OK:
			if FileAccess.file_exists(temporary):
				DirAccess.remove_absolute(temporary)
			return false
	token = value
	previous_tokens = history
	return true

func restore_previous_session() -> bool:
	if previous_tokens.is_empty():
		return false
	var staged: PackedStringArray = previous_tokens.duplicate()
	var previous: String = staged[0]
	staged.remove_at(0)
	if not token.is_empty() and not staged.has(token):
		staged.append(token)
	return _commit_session(previous, staged)

func request(path: String, method: HTTPClient.Method = HTTPClient.METHOD_GET, payload: Dictionary = {}) -> Dictionary:
	if test_mode:
		return {"ok": false, "error": {"code": "TEST_OFFLINE", "message": "测试模式：未连接服务"}}
	var http := HTTPRequest.new()
	http.timeout = 12.0
	add_child(http)
	var headers: PackedStringArray = ["Content-Type: application/json", "Accept: application/json"]
	if not token.is_empty():
		headers.append("Authorization: Bearer " + token)
	var body: String = JSON.stringify(payload) if method != HTTPClient.METHOD_GET else ""
	var started: Error = http.request(base_url + "/api/v1" + path, headers, method, body)
	if started != OK:
		http.queue_free()
		return {"ok": false, "error": {"code": "CONNECTION", "message": "暂时无法连接伙伴服务，请检查网络后重试。"}}
	var response: Array = await http.request_completed
	http.queue_free()
	if int(response[0]) != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "error": {"code": "CONNECTION", "message": "伙伴服务暂时没有回应。这次操作尚未确认，可以安全重试。"}}
	var parsed: Variant = JSON.parse_string((response[3] as PackedByteArray).get_string_from_utf8())
	if not parsed is Dictionary:
		return {"ok": false, "error": {"code": "RESPONSE", "message": "服务回应无法读取，请稍后重试。"}}
	var result: Dictionary = parsed
	result["http_status"] = int(response[1])
	return result

static func error_message(result: Dictionary) -> String:
	var error: Variant = result.get("error", {})
	if error is Dictionary:
		return str(error.get("message", "这次操作没有完成，请重试。"))
	return str(error)
