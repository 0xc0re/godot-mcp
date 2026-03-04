## Screenshot helper autoload for Godot MCP server.
##
## Monitors a trigger file at a fixed project-relative path and captures
## the viewport to PNG when triggered. Must be added as an autoload to the
## Godot project for capture_screenshot to work.
##
## Trigger file: res://.godot/screenshot_trigger
## Output file:  res://.godot/screenshot.png

extends Node

const TRIGGER_PATH := "res://.godot/screenshot_trigger"
const OUTPUT_PATH := "res://.godot/screenshot.png"
const POLL_INTERVAL := 0.5

var _elapsed: float = 0.0


func _ready() -> void:
	_elapsed = 0.0


func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed < POLL_INTERVAL:
		return
	_elapsed = 0.0

	if not FileAccess.file_exists(TRIGGER_PATH):
		return

	# Delete trigger file before capturing
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TRIGGER_PATH))

	# Wait for the current frame to finish rendering
	await RenderingServer.frame_post_draw

	# Capture the viewport
	var image: Image = get_viewport().get_texture().get_image()
	image.save_png(ProjectSettings.globalize_path(OUTPUT_PATH))
