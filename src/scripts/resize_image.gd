#!/usr/bin/env -S godot --headless --script
extends SceneTree

# Static image-resize script. Replaces the previous temp-script mechanism that
# string-interpolated the image path into GDScript source (a GDScript injection
# vector). Inputs arrive as positional argv after --script, mirroring the
# argument handling in godot_operations.gd:
#
#   godot --headless --script resize_image.gd <image_path> <width> <height>
#
# Output contract (matches godot_operations.gd's fail()/success convention):
#   failure -> prints {"success": false, "error": ...} on stdout, exits 1
#   success -> prints trailing {"success": true, ...} JSON on stdout, exits 0

# Tracks whether fail() was called, so the final quit() reports the correct
# process exit code (SceneTree.quit() defaults to exit code 0).
var exit_code := 0

func _init():
    var args = OS.get_cmdline_args()

    var script_index = args.find("--script")
    if script_index == -1:
        fail("Could not find --script argument")
        quit(exit_code)
        return

    # Positional args start right after the script path itself
    # (script_index + 1 is the script path).
    var image_path_index = script_index + 2
    var width_index = script_index + 3
    var height_index = script_index + 4

    if args.size() <= height_index:
        fail("Usage: godot --headless --script resize_image.gd <image_path> <width> <height>. Not enough command-line arguments provided.")
        quit(exit_code)
        return

    var image_path: String = args[image_path_index]
    var width_str: String = args[width_index]
    var height_str: String = args[height_index]

    if not width_str.is_valid_int() or not height_str.is_valid_int():
        fail("Width and height must be integers, got: " + width_str + ", " + height_str)
        quit(exit_code)
        return

    var width := int(width_str)
    var height := int(height_str)
    if width <= 0 or height <= 0:
        fail("Width and height must be positive, got: " + str(width) + "x" + str(height))
        quit(exit_code)
        return

    if not FileAccess.file_exists(image_path):
        fail("Image file does not exist: " + image_path)
        quit(exit_code)
        return

    var img = Image.load_from_file(image_path)
    if img == null or img.is_empty():
        fail("Failed to load image: " + image_path)
        quit(exit_code)
        return

    img.resize(width, height, Image.INTERPOLATE_BILINEAR)

    var err = img.save_png(image_path)
    if err != OK:
        fail("Failed to save resized image (error " + str(err) + "): " + image_path)
        quit(exit_code)
        return

    print(JSON.stringify({
        "success": true,
        "image_path": image_path,
        "width": width,
        "height": height,
    }))
    quit(exit_code)

## Print the JSON failure verdict on stdout, log the message to stderr, and
## mark the process to exit non-zero. Callers MUST `return` (after quit())
## immediately after calling fail().
func fail(message: String) -> void:
    print(JSON.stringify({"success": false, "error": message}))
    printerr("[ERROR] " + message)
    exit_code = 1
