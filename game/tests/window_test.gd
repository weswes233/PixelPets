extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var client = load("res://main.tscn").instantiate()
	root.add_child(client)
	await process_frame
	await process_frame
	var logical: Vector2 = root.get_visible_rect().size
	print("PixelPets actual window: physical=%s logical=%s client=%s small=%s" % [root.size, logical, client.size, client.small_layout])
	var portrait: bool = root.size.x < root.size.y
	var passed: bool = client.small_layout == portrait and client.content.get_combined_minimum_size().x <= logical.x - 36
	client.queue_free()
	await process_frame
	quit(0 if passed else 1)
