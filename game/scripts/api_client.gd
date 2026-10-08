extends Node
class_name PetAPI

var base_url: String = ""
var token: String = ""
var test_mode: bool = false

func _ready() -> void:
	base_url = str(ProjectSettings.get_setting("pixelpets/api_url", "http://127.0.0.1:9782"))
	if OS.has_feature("web"):
		var browser_window := JavaScriptBridge.get_interface("window")
		base_url = str(browser_window.location.origin)
	var configured: String = OS.get_environment("PIXELPETS_API_URL")
	if not configured.is_empty():
		base_url = configured.trim_suffix("/")
	var session := ConfigFile.new()
	if session.load("user://session.cfg") == OK:
		token = str(session.get_value("guest", "token", ""))

static func event_id() -> String:
	return Crypto.new().generate_random_bytes(16).hex_encode()

func save_token(value: String) -> void:
	token = value
	var session := ConfigFile.new()
	session.set_value("guest", "token", token)
	session.save("user://session.cfg")

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
