## Runtime helper autoload for Godot MCP server.
##
## Monitors a trigger file and responds with serialized scene tree data,
## node properties, group membership, or a viewport screenshot. Injected
## automatically by run_project as a TEMPORARY autoload named "RuntimeHelper"
## (copied into .godot/mcp/ and removed from project.godot on stop) — no
## manual setup is needed.
##
## Trigger file:    res://.godot/runtime_trigger   (JSON with "command" and "params")
## Output file:     res://.godot/runtime_result.json
## Screenshot file: res://.godot/screenshot.png    (written by the "screenshot" command)

extends Node

const TRIGGER_PATH := "res://.godot/runtime_trigger"
const OUTPUT_PATH := "res://.godot/runtime_result.json"
const SCREENSHOT_PATH := "res://.godot/screenshot.png"
const POLL_INTERVAL := 0.5
const MAX_TREE_DEPTH := 10

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

	# Read trigger content before deleting
	var trigger_content := FileAccess.get_file_as_string(TRIGGER_PATH)

	# Delete trigger file immediately to prevent re-reads
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TRIGGER_PATH))

	# Parse JSON command
	var json := JSON.new()
	if json.parse(trigger_content) != OK:
		_write_result({"error": "Failed to parse trigger JSON"})
		return

	var data = json.get_data()
	var command: String = data.get("command", "")
	var params: Dictionary = data.get("params", {})

	var result: Dictionary = {}
	match command:
		"scene_tree":
			result = _serialize_tree(get_tree().root)
		"inspect_node":
			result = _inspect_node(params.get("node_path", ""))
		"get_group":
			result = _get_group(params.get("group", ""))
		"screenshot":
			result = await _capture_screenshot()
		_:
			result = {"error": "Unknown command: " + command}

	_write_result(result)


func _write_result(result: Dictionary) -> void:
	var file := FileAccess.open(
		ProjectSettings.globalize_path(OUTPUT_PATH),
		FileAccess.WRITE
	)
	if file == null:
		return
	file.store_string(JSON.stringify(result))
	file.close()


func _serialize_tree(node: Node, depth: int = 0) -> Dictionary:
	var result := {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
		"children": []
	}
	if depth < MAX_TREE_DEPTH:
		for child in node.get_children():
			result["children"].append(_serialize_tree(child, depth + 1))
	return result


func _inspect_node(node_path: String) -> Dictionary:
	var node := get_node_or_null(node_path)
	if node == null:
		return {"error": "Node not found: " + node_path}

	var properties := {}
	for prop in node.get_property_list():
		# Filter to storage and script properties, skip internal ones
		if not (prop["usage"] & PROPERTY_USAGE_STORAGE):
			continue
		var prop_name: String = prop["name"]
		if prop_name.begins_with("_"):
			continue

		var val = node.get(prop_name)
		# Convert non-JSON-serializable Godot types via var_to_str()
		if val is Object or val is Vector2 or val is Vector2i \
			or val is Vector3 or val is Vector3i or val is Vector4 \
			or val is Vector4i or val is Color or val is NodePath \
			or val is Rect2 or val is Rect2i or val is Transform2D \
			or val is Transform3D or val is Basis or val is AABB \
			or val is Quaternion or val is Projection or val is RID:
			properties[prop_name] = var_to_str(val)
		else:
			properties[prop_name] = val

	return {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
		"properties": properties
	}


## Capture the viewport to SCREENSHOT_PATH and report the outcome.
##
## Headless-safe: with the headless display server there is no rendering
## surface (frame_post_draw never fires and the viewport has no texture),
## so the command fails fast with a structured error instead of hanging.
func _capture_screenshot() -> Dictionary:
	if DisplayServer.get_name() == "headless":
		return {
			"error": "Screenshot capture is not supported in headless mode (no rendering surface)"
		}

	# Wait for the current frame to finish rendering before grabbing pixels.
	await RenderingServer.frame_post_draw

	var viewport := get_viewport()
	if viewport == null:
		return {"error": "No viewport available"}
	var texture := viewport.get_texture()
	if texture == null:
		return {"error": "Viewport has no texture to capture"}
	var image: Image = texture.get_image()
	if image == null or image.is_empty():
		return {"error": "Failed to capture viewport image"}

	var err := image.save_png(ProjectSettings.globalize_path(SCREENSHOT_PATH))
	if err != OK:
		return {"error": "Failed to save screenshot PNG: error code " + str(err)}

	return {
		"success": true,
		"path": SCREENSHOT_PATH,
		"width": image.get_width(),
		"height": image.get_height()
	}


func _get_group(group_name: String) -> Dictionary:
	var nodes := get_tree().get_nodes_in_group(group_name)
	var result: Array[Dictionary] = []
	for node in nodes:
		result.append({
			"name": node.name,
			"type": node.get_class(),
			"path": str(node.get_path())
		})
	return {"group": group_name, "count": result.size(), "nodes": result}
