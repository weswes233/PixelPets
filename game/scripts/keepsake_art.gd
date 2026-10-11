extends Control
class_name KeepsakeArt
## Original pixel illustrations. No external textures or download is needed.
var item_id: String = "warm_pebble"
var discovered: bool = true

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)

func pixel(rect: Rect2, color: String) -> void:
	var scale_factor: float = maxf(1, floorf(minf(size.x, size.y) / 32.0))
	var origin := ((size - Vector2(32, 32) * scale_factor) / 2).floor()
	draw_rect(Rect2(origin + rect.position * scale_factor, rect.size * scale_factor), Color(color) if discovered else Color("b9beb0"))

func _draw() -> void:
	var ink := "52625b"
	match item_id:
		"warm_pebble":
			pixel(Rect2(5, 24, 23, 3), "e0ddc7")
			pixel(Rect2(6, 14, 20, 10), ink)
			pixel(Rect2(10, 10, 12, 16), ink)
			pixel(Rect2(8, 15, 16, 7), "c7b093")
			pixel(Rect2(12, 12, 8, 12), "dac6a4")
			pixel(Rect2(12, 13, 5, 2), "f7e5bc")
		"market_ticket", "night_map":
			pixel(Rect2(5, 7, 22, 19), ink)
			pixel(Rect2(7, 9, 18, 15), "ead9b5")
			pixel(Rect2(10, 12, 12, 2), "bd8a73" if item_id == "market_ticket" else "7e95a4")
			pixel(Rect2(10, 18, 8, 2), "bd8a73" if item_id == "market_ticket" else "7e95a4")
			pixel(Rect2(20, 17, 2, 5), "bd8a73")
			pixel(Rect2(4, 15, 3, 3), "f8f4e8")
			pixel(Rect2(25, 15, 3, 3), "f8f4e8")
		"honey_bun":
			pixel(Rect2(5, 17, 22, 9), "bf8f73")
			pixel(Rect2(7, 13, 18, 10), "d9ac76")
			pixel(Rect2(10, 10, 12, 12), "ebca8c")
			pixel(Rect2(9, 22, 14, 5), "f1e6c8")
			pixel(Rect2(12, 13, 2, 5), "bb8b63")
			pixel(Rect2(18, 13, 2, 5), "bb8b63")
		"golden_bell":
			pixel(Rect2(14, 5, 4, 4), ink)
			pixel(Rect2(10, 9, 12, 13), ink)
			pixel(Rect2(7, 20, 18, 4), ink)
			pixel(Rect2(12, 10, 8, 12), "e5b85b")
			pixel(Rect2(9, 21, 14, 2), "f3d989")
			pixel(Rect2(14, 24, 4, 3), "c9944f")
			pixel(Rect2(13, 11, 2, 7), "fff0b3")
		"moth_bookmark":
			pixel(Rect2(11, 6, 10, 21), "b8a2b5")
			pixel(Rect2(13, 8, 6, 15), "ded1d9")
			pixel(Rect2(6, 12, 8, 5), "8c91ad")
			pixel(Rect2(18, 12, 8, 5), "8c91ad")
			pixel(Rect2(15, 11, 2, 9), ink)
			pixel(Rect2(11, 26, 3, 3), "b8a2b5")
			pixel(Rect2(18, 26, 3, 3), "b8a2b5")
		"dew_bottle":
			pixel(Rect2(12, 5, 8, 4), "ad8d70")
			pixel(Rect2(12, 9, 8, 5), ink)
			pixel(Rect2(8, 13, 16, 14), ink)
			pixel(Rect2(10, 14, 12, 11), "b2d2cd")
			pixel(Rect2(11, 19, 10, 5), "7aa9b6")
			pixel(Rect2(11, 15, 2, 7), "f4f3d7")
		"last_lantern":
			pixel(Rect2(12, 4, 8, 6), ink)
			pixel(Rect2(14, 6, 4, 4), "f8f4e8")
			pixel(Rect2(9, 10, 14, 17), ink)
			pixel(Rect2(11, 12, 10, 11), "e9bb7b")
			pixel(Rect2(14, 15, 4, 6), "fff0b3")
			pixel(Rect2(7, 26, 18, 2), ink)
	if not discovered:
		pixel(Rect2(13, 12, 6, 2), "f8f4e8")
		pixel(Rect2(17, 14, 2, 3), "f8f4e8")
		pixel(Rect2(15, 17, 2, 2), "f8f4e8")
		pixel(Rect2(15, 21, 2, 2), "f8f4e8")
