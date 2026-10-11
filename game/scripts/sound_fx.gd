extends AudioStreamPlayer
## Quiet, original synthesized chimes; no external audio assets.
var enabled: bool = true

func chime(kind: String = "care") -> void:
	if not enabled:
		return
	var notes: Array = [523.25, 659.25]
	if kind == "pick":
		notes = [783.99]
	elif kind in ["grow", "postcard"]:
		notes = [523.25, 659.25, 783.99, 1046.5]
	var rate: int = 22050
	var note_frames: int = 2646
	var bytes := PackedByteArray()
	bytes.resize(note_frames * notes.size() * 2)
	for n in range(notes.size()):
		for i in range(note_frames):
			var position: float = float(i) / rate
			var envelope: float = minf(1.0, float(i) / 150.0) * pow(1.0 - float(i) / note_frames, 2)
			var wave: float = sin(TAU * float(notes[n]) * position) * envelope
			bytes.encode_s16((n * note_frames + i) * 2, int(wave * 12000))
	var sound := AudioStreamWAV.new()
	sound.format = AudioStreamWAV.FORMAT_16_BITS
	sound.mix_rate = rate
	sound.data = bytes
	stream = sound
	volume_db = -17
	play()
