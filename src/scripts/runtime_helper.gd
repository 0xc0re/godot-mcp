## Runtime inspection helper autoload for Godot MCP server.
##
## Monitors a trigger file and responds with serialized scene tree data,
## node properties, or group membership as JSON. Must be added as an
## autoload named "RuntimeHelper" in the Godot project settings.
##
## Setup: Project > Project Settings > Autoloads > Add this script
##
## Trigger file: res://.godot/runtime_trigger   (JSON with "command" and "params")
## Output file:  res://.godot/runtime_result.json

extends Node

const TRIGGER_PATH := "res://.godot/runtime_trigger"
const OUTPUT_PATH := "res://.godot/runtime_result.json"
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
