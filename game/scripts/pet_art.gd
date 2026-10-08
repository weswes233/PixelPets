extends Control
class_name PetArt

var species: String = "moss"
var form: String = "seed"
var habitat: String = ""
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
		draw_rect(Rect2(Vector2.ZERO, size), Color("e5e7f1") if habitat == "moon" or (habitat.is_empty() and form == "moon") else Color("e5eee3"))
		for i in range(6):
			var x: float = fmod(float(i * 113 + 22) + time * 3.0, size.x + 40) - 20
			draw_rect(Rect2(x, 30 + (i % 3) * 19, 20 + (i % 2) * 22, 4), Color("f6f7ec"))
		draw_rect(Rect2(0, size.y * 0.8, size.x, size.y * 0.2), Color("cfdac4"))
		for i in range(13):
			draw_rect(Rect2(float(i) * size.x / 12.0, size.y * 0.8 - 3, 3, 7), Color("a8bea1"))
		draw_rect(Rect2(size.x * 0.5 - s * 12, origin.y + s * 27, s * 24, s * 3), Color("b5c8af"))
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
