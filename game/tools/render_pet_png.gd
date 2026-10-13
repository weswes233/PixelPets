extends SceneTree
## Exports deterministic metadata images from the same PetArt drawing code used in the game.
## Usage: godot --path game --rendering-method gl_compatibility --script tools/render_pet_png.gd -- --out <dir> [--scale 10]

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	var out_dir: String = "user://pet-png"
	var scale_factor: int = 10
	for i in range(args.size() - 1):
		if args[i] == "--out": out_dir = args[i + 1]
		if args[i] == "--scale": scale_factor = int(args[i + 1])
	DirAccess.make_dir_recursive_absolute(out_dir)
	var failures: int = 0
	for species in ["moss", "puddle", "wisp"]:
		for form in ["seed", "sun", "moon"]:
			var viewport := SubViewport.new()
			viewport.size = Vector2i(48 * scale_factor, 43 * scale_factor)
			viewport.transparent_bg = false
			viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
			root.add_child(viewport)
			var art := PetArt.new()
			art.species = species
			art.form = form
			art.animated = false
			art.show_habitat = true
			art.size = Vector2(viewport.size)
			viewport.add_child(art)
			await process_frame
			await RenderingServer.frame_post_draw
			var image: Image = viewport.get_texture().get_image()
			var path: String = "%s/%s-%s.png" % [out_dir, species, form]
			if image == null or image.is_empty() or image.save_png(path) != OK:
				failures += 1
				push_error("Could not render " + path)
			else:
				print("rendered ", path)
			viewport.queue_free()
	quit(1 if failures else 0)
