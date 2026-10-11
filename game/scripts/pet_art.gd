extends Control
class_name PetArt

var species: String = "moss"
var form: String = "seed"
var habitat: String = ""
var scene: String = "garden"
var show_habitat: bool = true
var animated: bool = true
var reaction: String = ""
var time: float = 0.0
var reaction_left: float = 0.0
const INK: Color = Color("394748")
const MINT: Color = Color("96bda1")
const PEACH: Color = Color("ebad98")

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip_contents = true
	resized.connect(queue_redraw)

func _process(delta: float) -> void:
	if animated:
		time += delta
		reaction_left = maxf(0.0, reaction_left - delta)
		queue_redraw()

func celebrate(kind: String) -> void:
	reaction = kind
	reaction_left = 2.5

func px(origin: Vector2, scale_factor: float, rect: Rect2, color: Color) -> void:
	draw_rect(Rect2(origin + rect.position * scale_factor, rect.size * scale_factor), color)

func _draw() -> void:
	if size.x < 2 or size.y < 2:
		return
	var s: float = maxf(1, floorf(minf(size.x / 48.0, size.y / 43.0)))
	var bob: float = roundf(sin(time * 2.3)) * s if animated else 0.0
	if reaction_left > 0:
		bob -= absf(sin(time * 9.0)) * s * 2.0
	var origin: Vector2 = (size - Vector2(32, 32) * s) * 0.5 + Vector2(0, bob + s)
	if show_habitat:
		_draw_landscape()
		draw_rect(Rect2(size.x * 0.5 - s * 11, origin.y + s * 27, s * 22, s * 2), Color("8ca793", 0.45))
	var body: Color = MINT
	var light: Color = Color("c7dec3")
	if form == "sun":
		body = Color("d4ad67") if species == "moss" else Color("91b496")
		light = Color("f0d998")
	elif form == "moon":
		body = Color("9499bf")
		light = Color("d6d8ef")
	if species == "moss":
		px(origin,s,Rect2(5,7,7,9),INK)
		px(origin,s,Rect2(20,7,7,9),INK)
		px(origin,s,Rect2(7,9,3,6),PEACH)
		px(origin,s,Rect2(22,9,3,6),PEACH)
		px(origin,s,Rect2(4,14,24,11),INK)
		px(origin,s,Rect2(6,12,20,14),INK)
		px(origin,s,Rect2(6,15,20,9),body)
		px(origin,s,Rect2(8,13,16,12),body)
		px(origin,s,Rect2(9,23,14,4),INK)
		px(origin,s,Rect2(11,23,10,2),light)
		px(origin,s,Rect2(3,21,4,2),body)
		px(origin,s,Rect2(2,19,2,4),INK)
		px(origin,s,Rect2(11,17,2,3),INK)
		px(origin,s,Rect2(19,17,2,3),INK)
		px(origin,s,Rect2(15,21,2,1),INK)
		px(origin,s,Rect2(8,21,3,1),PEACH)
		px(origin,s,Rect2(22,21,3,1),PEACH)
	elif species == "puddle":
		px(origin,s,Rect2(6,10,7,8),INK)
		px(origin,s,Rect2(19,10,7,8),INK)
		px(origin,s,Rect2(4,17,24,9),INK)
		px(origin,s,Rect2(6,15,20,12),INK)
		px(origin,s,Rect2(8,12,3,6),light)
		px(origin,s,Rect2(21,12,3,6),light)
		px(origin,s,Rect2(6,18,20,7),body)
		px(origin,s,Rect2(8,16,16,10),body)
		px(origin,s,Rect2(8,13,2,3),INK)
		px(origin,s,Rect2(22,13,2,3),INK)
		px(origin,s,Rect2(11,21,10,1),INK)
		px(origin,s,Rect2(3,26,9,2),INK)
		px(origin,s,Rect2(20,26,9,2),INK)
		px(origin,s,Rect2(7,20,3,2),PEACH)
		px(origin,s,Rect2(23,20,3,2),PEACH)
	else:
		body = Color("bcb6d4") if form == "seed" else body
		light = Color("eae4ed") if form == "seed" else light
		px(origin,s,Rect2(11,7,10,3),INK)
		px(origin,s,Rect2(7,10,18,15),INK)
		px(origin,s,Rect2(5,15,22,7),INK)
		px(origin,s,Rect2(9,11,14,13),body)
		px(origin,s,Rect2(11,9,10,13),body)
		px(origin,s,Rect2(7,16,18,5),body)
		px(origin,s,Rect2(9,24,5,3),INK)
		px(origin,s,Rect2(18,24,5,3),INK)
		px(origin,s,Rect2(10,23,3,3),body)
		px(origin,s,Rect2(19,23,3,3),body)
		px(origin,s,Rect2(11,13,3,4),light)
		px(origin,s,Rect2(12,17,2,3),INK)
		px(origin,s,Rect2(20,17,2,3),INK)
		px(origin,s,Rect2(16,22,2,1),INK)
	if form == "sun":
		px(origin,s,Rect2(14,4,5,5),Color("e9bc61"))
		px(origin,s,Rect2(16,2,1,9),Color("e9bc61"))
		px(origin,s,Rect2(12,6,9,1),Color("e9bc61"))
		px(origin,s,Rect2(15,5,3,3),Color("fff0b7"))
	elif form == "moon":
		px(origin,s,Rect2(15,3,5,6),Color("f4efcf"))
		px(origin,s,Rect2(18,3,3,4),Color("9499bf"))
	if int(time * 2) % 13 == 12:
		var eyey: int = 13 if species == "puddle" else 17
		px(origin,s,Rect2(11 if species == "moss" else 12, eyey, 2, 1),INK)
	if reaction_left > 0:
		for j in range(3):
			var point: Vector2 = origin + Vector2(3 + j * 11, 3 - int(time * 4 + j) % 4) * s
			draw_rect(Rect2(point, Vector2(s, s * 3)), PEACH)
			draw_rect(Rect2(point + Vector2(-s, s), Vector2(s * 3, s)), PEACH)

func _tile(x: float, y: float, w: float, h: float, color: String) -> void:
	# A fixed pixel grid keeps scenery crisp at every viewport size.
	var scale_xy := Vector2(size.x / 160.0, size.y / 96.0)
	var start := (Vector2(x, y) * scale_xy).round()
	var end := (Vector2(x + w, y + h) * scale_xy).round()
	draw_rect(Rect2(start, end - start), Color(color))

func _draw_landscape() -> void:
	var night: bool = habitat == "moon" or (habitat.is_empty() and form == "moon")
	draw_rect(Rect2(Vector2.ZERO, size), Color("343e67") if night else Color("dcece1"))
	_tile(0, 52, 160, 44, "59658a" if night else "b7d2b8")
	for i in range(6):
		var x: float = float(i * 31 - 12)
		_tile(x, 44 - i % 3 * 6, 37, 25, "4c5c7d" if night else "c5dabb")
		_tile(x + 5, 39 - i % 3 * 6, 25, 12, "4c5c7d" if night else "c5dabb")
	_tile(0, 69, 160, 27, "657c7c" if night else "9fbd99")
	_tile(0, 73, 160, 23, "718a84" if night else "b6cda7")
	_tile(51, 79, 62, 17, "8b9991" if night else "d6d5b1")
	_tile(59, 73, 46, 8, "8b9991" if night else "d6d5b1")
	if night:
		_tile(126, 10, 11, 13, "fbebbb")
		_tile(130, 8, 8, 16, "fbebbb")
		_tile(134, 7, 7, 12, "343e67")
		for i in range(15):
			var x: int = (i * 43 + 9) % 154
			var y: int = (i * 17 + 8) % 39
			_tile(x, y, 1, 2 if sin(time * 1.4 + i) > 0.5 else 1, "e6debe")
	else:
		_tile(126, 11, 14, 14, "efd18d")
		_tile(123, 14, 20, 8, "efd18d")
		for i in range(3):
			var x: float = fmod(float(i * 61) + time * 1.5, 190.0) - 25
			_tile(x, 14 + i % 2 * 13, 21, 4, "f6f5de")
			_tile(x + 5, 11 + i % 2 * 13, 12, 3, "f6f5de")
	if scene == "sunny_market":
		for x in [7, 119]:
			_tile(x + 2, 44, 28, 28, "b49374")
			_tile(x, 40, 32, 8, "f2dfad")
			for j in range(4):
				_tile(x + j * 8, 40, 4, 10, "c87e65")
			_tile(x + 5, 51, 22, 12, "5c7263")
			_tile(x, 65, 33, 5, "d7b087")
			for j in range(3):
				_tile(x + 5 + j * 8, 61, 5, 4, "efcb76")
	elif scene == "moonlit_lane":
		for x in [18, 43, 118, 143]:
			_tile(x, 28, 2, 47, "424d64")
			_tile(x - 5, 31, 12, 13, "b49078")
			_tile(x - 3, 33, 8, 9, "f0d592")
			_tile(x - 1, 44, 4, 2, "eab177")
		_tile(18, 28, 127, 1, "8b98a4")
	else:
		# Your little cottage and the pond remain visible around the companion.
		_tile(8, 49, 29, 23, "d8c7a0" if not night else "a1a28e")
		_tile(5, 45, 35, 6, "ac7e68")
		_tile(10, 40, 25, 5, "ac7e68")
		_tile(15, 36, 15, 4, "ac7e68")
		_tile(13, 55, 7, 7, "f2d894")
		_tile(25, 56, 8, 16, "7e8a75")
		_tile(120, 78, 33, 8, "86afb0" if not night else "627b94")
		_tile(124, 75, 24, 14, "86afb0" if not night else "627b94")
		_tile(130, 78, 12, 1, "c1dad1")
	for x in [4, 39, 117, 151]:
		_tile(x, 63, 2, 12, "667c61")
		_tile(x - 4, 57, 10, 9, "728e71" if not night else "435e66")
		_tile(x - 2, 53, 7, 8, "87a17b" if not night else "4f6d71")
	for i in range(18):
		var x: int = (i * 29 + 5) % 157
		var y: int = 81 + (i * 7) % 13
		if x > 52 and x < 113:
			continue
		_tile(x, y, 1, 3, "789674")
		_tile(x - 1, y, 3, 1, "e5c2a1" if i % 2 == 0 else "e9dfb2")
