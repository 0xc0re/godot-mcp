## Runtime helper autoload for Godot MCP server.
##
## Monitors a trigger file and responds with serialized scene tree data,
## node properties, group membership, a viewport screenshot, injected input
## events, structured method calls / property writes, or one-shot condition
## checks. All commands take structured params only — there is NO expression
## evaluation or script execution surface here by design. Injected
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
		"send_input":
			result = _send_input(params)
		"call_method":
			result = _call_method(params)
		"set_property":
			result = _set_property(params)
		"check_condition":
			result = _check_condition(params)
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

		properties[prop_name] = _jsonify_value(node.get(prop_name))

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


## Convert a Godot value to a JSON-serializable representation.
##
## Non-JSON Godot types (vectors, colors, transforms, objects, ...) are
## rendered via var_to_str(); JSON-native values pass through unchanged.
func _jsonify_value(val):
	if val is Object or val is Vector2 or val is Vector2i \
		or val is Vector3 or val is Vector3i or val is Vector4 \
		or val is Vector4i or val is Color or val is NodePath \
		or val is Rect2 or val is Rect2i or val is Transform2D \
		or val is Transform3D or val is Basis or val is AABB \
		or val is Quaternion or val is Projection or val is RID:
		return var_to_str(val)
	if val is Array:
		var out := []
		for item in val:
			out.append(_jsonify_value(item))
		return out
	if val is Dictionary:
		var out := {}
		for key in val:
			out[str(key)] = _jsonify_value(val[key])
		return out
	return val


## Decode a structured typed-value spec into a Godot value.
##
## Plain JSON values (numbers, strings, bools, null) pass through.
## Dictionaries of the form {"type": "<whitelisted>", "value": [...]} are
## decoded into the matching Godot type. This is a fixed whitelist of value
## constructors — NOT expression evaluation; arbitrary strings are never
## parsed or executed (no str_to_var, no Expression).
func _decode_value(value):
	if value is Array:
		var out := []
		for item in value:
			out.append(_decode_value(item))
		return out
	if not value is Dictionary:
		return value
	if not (value.has("type") and value.has("value")):
		# Plain dictionary payload: decode values recursively.
		var out := {}
		for key in value:
			out[str(key)] = _decode_value(value[key])
		return out
	var t: String = str(value["type"])
	var v = value["value"]
	match t:
		"Vector2":
			if v is Array and v.size() == 2:
				return Vector2(float(v[0]), float(v[1]))
		"Vector2i":
			if v is Array and v.size() == 2:
				return Vector2i(int(v[0]), int(v[1]))
		"Vector3":
			if v is Array and v.size() == 3:
				return Vector3(float(v[0]), float(v[1]), float(v[2]))
		"Vector3i":
			if v is Array and v.size() == 3:
				return Vector3i(int(v[0]), int(v[1]), int(v[2]))
		"Color":
			if v is Array and v.size() >= 3:
				var a := 1.0
				if v.size() >= 4:
					a = float(v[3])
				return Color(float(v[0]), float(v[1]), float(v[2]), a)
		"NodePath":
			return NodePath(str(v))
	# Unknown type tag or malformed value: return null so the mismatch is
	# visible instead of silently passing the raw dictionary through.
	return null


## Inject a parameterized input event via Input.parse_input_event.
##
## Event construction is fully structured (event type + fields); no free-form
## event data is accepted. Note: with the headless display server, generated
## events still flow through the Input singleton (action states update and
## _input callbacks fire), but anything requiring a real window (focus,
## mouse capture) is inert.
func _send_input(params: Dictionary) -> Dictionary:
	var event_type: String = str(params.get("event_type", ""))
	var pressed: bool = bool(params.get("pressed", true))
	var event: InputEvent = null
	var detail := {}

	match event_type:
		"action":
			var action: String = str(params.get("action", ""))
			if action == "":
				return {"error": "send_input: 'action' is required for event_type 'action'"}
			if not InputMap.has_action(action):
				return {"error": "send_input: unknown input action: " + action}
			var ev := InputEventAction.new()
			ev.action = action
			ev.pressed = pressed
			ev.strength = clampf(float(params.get("strength", 1.0)), 0.0, 1.0)
			event = ev
			detail = {"action": action}
		"key":
			var keycode_name: String = str(params.get("keycode", ""))
			var keycode := OS.find_keycode_from_string(keycode_name)
			if keycode == KEY_NONE:
				return {"error": "send_input: unknown keycode: " + keycode_name}
			var ev := InputEventKey.new()
			ev.keycode = keycode
			ev.physical_keycode = keycode
			ev.pressed = pressed
			event = ev
			detail = {"keycode": keycode_name}
		"mouse_button":
			var button_index := int(params.get("button_index", MOUSE_BUTTON_LEFT))
			var ev := InputEventMouseButton.new()
			ev.button_index = button_index as MouseButton
			ev.pressed = pressed
			var pos = params.get("position", null)
			if pos is Dictionary:
				ev.position = Vector2(float(pos.get("x", 0.0)), float(pos.get("y", 0.0)))
				ev.global_position = ev.position
			event = ev
			detail = {"button_index": button_index}
		_:
			return {
				"error": "send_input: unknown event_type: '" + event_type +
					"' (expected 'action', 'key', or 'mouse_button')"
			}

	Input.parse_input_event(event)
	# Flush so the event is visible to the game immediately instead of on
	# the next buffered-input flush.
	Input.flush_buffered_events()

	var result := {"success": true, "event_type": event_type, "pressed": pressed}
	result.merge(detail)
	return result


## Call a method on a live node: plain identifier method name + typed args
## array only (structured params — never expression strings).
func _call_method(params: Dictionary) -> Dictionary:
	var node_path: String = str(params.get("node_path", ""))
	var node := get_node_or_null(node_path)
	if node == null:
		return {"error": "Node not found: " + node_path}

	var method: String = str(params.get("method", ""))
	if not method.is_valid_identifier():
		return {
			"error": "call_method: method must be a plain identifier " +
				"(structured params only, no expressions): " + method
		}
	if not node.has_method(method):
		return {"error": "Method not found on " + node_path + ": " + method}

	var raw_args = params.get("args", [])
	if not raw_args is Array:
		return {"error": "call_method: 'args' must be an array"}
	var call_args := []
	for arg in raw_args:
		call_args.append(_decode_value(arg))

	var result = node.callv(method, call_args)
	return {
		"success": true,
		"node_path": node_path,
		"method": method,
		"result": _jsonify_value(result)
	}


## Set a property on a live node: identifier(:subname)* property path + typed
## value only. Reads the property back after the write so the caller sees the
## value the engine actually accepted.
func _set_property(params: Dictionary) -> Dictionary:
	var node_path: String = str(params.get("node_path", ""))
	var node := get_node_or_null(node_path)
	if node == null:
		return {"error": "Node not found: " + node_path}

	var property: String = str(params.get("property", ""))
	var segments := property.split(":")
	for segment in segments:
		if not segment.is_valid_identifier():
			return {
				"error": "set_property: property must be an identifier or " +
					"colon-separated subpath (structured params only): " + property
			}
	if not params.has("value"):
		return {"error": "set_property: 'value' is required"}

	var root_name := segments[0]
	if not (root_name in node):
		return {"error": "Property not found on " + node_path + ": " + root_name}

	var value = _decode_value(params.get("value"))
	var observed
	if segments.size() > 1:
		node.set_indexed(NodePath(property), value)
		observed = node.get_indexed(NodePath(property))
	else:
		node.set(root_name, value)
		observed = node.get(root_name)

	return {
		"success": true,
		"node_path": node_path,
		"property": property,
		"value": _jsonify_value(observed)
	}


## Evaluate a structured condition spec once.
##
## Returns {"passed": bool, "observed": <value>} so a server-side wait loop
## can poll it. Transient states (node not there YET) report passed=false
## rather than an error so callers can keep waiting; malformed specs error.
func _check_condition(params: Dictionary) -> Dictionary:
	var condition = params.get("condition", {})
	if not condition is Dictionary:
		return {"error": "check_condition: 'condition' must be a dictionary"}

	var ctype: String = str(condition.get("type", ""))
	match ctype:
		"node_exists":
			var node := get_node_or_null(str(condition.get("node_path", "")))
			return {"passed": node != null, "observed": node != null}
		"property":
			return _check_property_condition(condition)
		"group_count":
			var group: String = str(condition.get("group", ""))
			if group == "":
				return {"error": "check_condition: 'group' is required for group_count"}
			var count := get_tree().get_nodes_in_group(group).size()
			return _finish_comparison(condition, count)
		"elapsed_frames":
			var current := Engine.get_process_frames()
			var frames := int(condition.get("frames", 0))
			var since = condition.get("since_frame", null)
			if since == null:
				# Baseline poll: report the current frame count so the
				# server can anchor the wait window.
				return {"passed": false, "observed": current}
			return {"passed": current - int(since) >= frames, "observed": current}
		_:
			return {
				"error": "check_condition: unknown condition type: '" + ctype +
					"' (expected 'node_exists', 'property', 'group_count', or 'elapsed_frames')"
			}


func _check_property_condition(condition: Dictionary) -> Dictionary:
	var node_path: String = str(condition.get("node_path", ""))
	var node := get_node_or_null(node_path)
	if node == null:
		# The node may simply not exist yet — a waitable false, not an error.
		return {"passed": false, "observed": null, "detail": "node not found: " + node_path}

	var property: String = str(condition.get("property", ""))
	var segments := property.split(":")
	for segment in segments:
		if not segment.is_valid_identifier():
			return {
				"error": "check_condition: property must be an identifier or " +
					"colon-separated subpath: " + property
			}
	if not (segments[0] in node):
		return {
			"passed": false,
			"observed": null,
			"detail": "property not found: " + property
		}

	var actual = node.get_indexed(NodePath(property)) if segments.size() > 1 else node.get(segments[0])
	return _finish_comparison(condition, actual)


## Compare an observed value against condition["value"] with condition["op"]
## (eq/ne/gt/lt/ge/le) and optional float tolerance. Shared by the property
## and group_count condition types.
func _finish_comparison(condition: Dictionary, actual) -> Dictionary:
	var op: String = str(condition.get("op", "eq"))
	if not condition.has("value"):
		return {"error": "check_condition: 'value' is required for comparisons"}
	var expected = _decode_value(condition.get("value"))
	var tolerance := absf(float(condition.get("tolerance", 0.0)))

	var actual_num := actual is int or actual is float
	var expected_num := expected is int or expected is float

	var passed := false
	match op:
		"eq", "ne":
			var equal: bool
			if actual_num and expected_num:
				equal = absf(float(actual) - float(expected)) <= tolerance
			elif (actual is Vector2 and expected is Vector2) \
				or (actual is Vector3 and expected is Vector3):
				equal = actual.is_equal_approx(expected) if tolerance > 0.0 else actual == expected
			else:
				equal = typeof(actual) == typeof(expected) and actual == expected
			passed = equal if op == "eq" else not equal
		"gt", "lt", "ge", "le":
			if not (actual_num and expected_num):
				return {
					"error": "check_condition: op '" + op + "' requires numeric values, got " +
						type_string(typeof(actual)) + " vs " + type_string(typeof(expected)),
					"observed": _jsonify_value(actual)
				}
			match op:
				"gt": passed = float(actual) > float(expected)
				"lt": passed = float(actual) < float(expected)
				"ge": passed = float(actual) >= float(expected)
				"le": passed = float(actual) <= float(expected)
		_:
			return {"error": "check_condition: unknown op: '" + op + "' (expected eq/ne/gt/lt/ge/le)"}

	return {"passed": passed, "observed": _jsonify_value(actual)}
