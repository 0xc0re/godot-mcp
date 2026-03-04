#!/usr/bin/env -S godot --headless --script
extends SceneTree

# Debug mode flag
var debug_mode = false

func _init():
    var args = OS.get_cmdline_args()
    
    # Check for debug flag
    debug_mode = "--debug-godot" in args
    
    # Find the script argument and determine the positions of operation and params
    var script_index = args.find("--script")
    if script_index == -1:
        log_error("Could not find --script argument")
        quit(1)
    
    # The operation should be 2 positions after the script path (script_index + 1 is the script path itself)
    var operation_index = script_index + 2
    # The params should be 3 positions after the script path
    var params_index = script_index + 3
    
    if args.size() <= params_index:
        log_error("Usage: godot --headless --script godot_operations.gd <operation> <json_params>")
        log_error("Not enough command-line arguments provided.")
        quit(1)
    
    # Log all arguments for debugging
    log_debug("All arguments: " + str(args))
    log_debug("Script index: " + str(script_index))
    log_debug("Operation index: " + str(operation_index))
    log_debug("Params index: " + str(params_index))
    
    var operation = args[operation_index]
    var params_json = args[params_index]
    
    log_info("Operation: " + operation)
    log_debug("Params JSON: " + params_json)
    
    # Parse JSON using Godot 4.x API
    var json = JSON.new()
    var error = json.parse(params_json)
    var params = null
    
    if error == OK:
        params = json.get_data()
    else:
        log_error("Failed to parse JSON parameters: " + params_json)
        log_error("JSON Error: " + json.get_error_message() + " at line " + str(json.get_error_line()))
        quit(1)
    
    if not params:
        log_error("Failed to parse JSON parameters: " + params_json)
        quit(1)
    
    log_info("Executing operation: " + operation)
    
    match operation:
        "create_scene":
            create_scene(params)
        "add_node":
            add_node(params)
        "load_sprite":
            load_sprite(params)
        "export_mesh_library":
            export_mesh_library(params)
        "save_scene":
            save_scene(params)
        "get_uid":
            get_uid(params)
        "resave_resources":
            resave_resources(params)
        "modify_node_property":
            modify_node_property(params)
        "remove_node":
            remove_node(params)
        "attach_script":
            attach_script(params)
        "create_resource":
            create_resource(params)
        "validate_scripts":
            validate_scripts(params)
        "modify_project_setting":
            modify_project_setting(params)
        "list_scripts":
            list_scripts(params)
        "query_class":
            query_class(params)
        "connect_signal":
            connect_signal(params)
        "disconnect_signal":
            disconnect_signal(params)
        "instance_scene":
            instance_scene(params)
        "batch_set_properties":
            batch_set_properties(params)
        "manage_groups":
            manage_groups(params)
        "add_input_action":
            add_input_action(params)
        "remove_input_action":
            remove_input_action(params)
        "create_shader_material":
            create_shader_material(params)
        "set_shader_params":
            set_shader_params(params)
        "create_animation":
            create_animation(params)
        "create_animation_library":
            create_animation_library(params)
        "add_keyframes":
            add_keyframes(params)
        "assign_animation_library":
            assign_animation_library(params)
        _:
            log_error("Unknown operation: " + operation)
            quit(1)
    
    quit()

# Logging functions
func log_debug(message):
    if debug_mode:
        print("[DEBUG] " + message)

func log_info(message):
    print("[INFO] " + message)

func log_error(message):
    printerr("[ERROR] " + message)

## Resolve a node path relative to the scene root.
## Handles "root", "root/Path/To/Node", and plain relative paths.
func find_node_by_path(scene_root: Node, node_path: String) -> Node:
    if node_path == "root" or node_path == "":
        return scene_root
    var target = scene_root
    if node_path.begins_with("root/"):
        var relative_path = node_path.substr(5)
        if relative_path != "":
            target = scene_root.get_node_or_null(relative_path)
    else:
        target = scene_root.get_node_or_null(node_path)
    return target

# Get a script by name or path
func get_script_by_name(name_of_class):
    if debug_mode:
        print("Attempting to get script for class: " + name_of_class)
    
    # Try to load it directly if it's a resource path
    if ResourceLoader.exists(name_of_class, "Script"):
        if debug_mode:
            print("Resource exists, loading directly: " + name_of_class)
        var script = load(name_of_class) as Script
        if script:
            if debug_mode:
                print("Successfully loaded script from path")
            return script
        else:
            printerr("Failed to load script from path: " + name_of_class)
    elif debug_mode:
        print("Resource not found, checking global class registry")
    
    # Search for it in the global class registry if it's a class name
    var global_classes = ProjectSettings.get_global_class_list()
    if debug_mode:
        print("Searching through " + str(global_classes.size()) + " global classes")
    
    for global_class in global_classes:
        var found_name_of_class = global_class["class"]
        var found_path = global_class["path"]
        
        if found_name_of_class == name_of_class:
            if debug_mode:
                print("Found matching class in registry: " + found_name_of_class + " at path: " + found_path)
            var script = load(found_path) as Script
            if script:
                if debug_mode:
                    print("Successfully loaded script from registry")
                return script
            else:
                printerr("Failed to load script from registry path: " + found_path)
                break
    
    printerr("Could not find script for class: " + name_of_class)
    return null

# Instantiate a class by name
func instantiate_class(name_of_class):
    if name_of_class.is_empty():
        printerr("Cannot instantiate class: name is empty")
        return null
    
    var result = null
    if debug_mode:
        print("Attempting to instantiate class: " + name_of_class)
    
    # Check if it's a built-in class
    if ClassDB.class_exists(name_of_class):
        if debug_mode:
            print("Class exists in ClassDB, using ClassDB.instantiate()")
        if ClassDB.can_instantiate(name_of_class):
            result = ClassDB.instantiate(name_of_class)
            if result == null:
                printerr("ClassDB.instantiate() returned null for class: " + name_of_class)
        else:
            printerr("Class exists but cannot be instantiated: " + name_of_class)
            printerr("This may be an abstract class or interface that cannot be directly instantiated")
    else:
        # Try to get the script
        if debug_mode:
            print("Class not found in ClassDB, trying to get script")
        var script = get_script_by_name(name_of_class)
        if script is GDScript:
            if debug_mode:
                print("Found GDScript, creating instance")
            result = script.new()
        else:
            printerr("Failed to get script for class: " + name_of_class)
            return null
    
    if result == null:
        printerr("Failed to instantiate class: " + name_of_class)
    elif debug_mode:
        print("Successfully instantiated class: " + name_of_class + " of type: " + result.get_class())
    
    return result

# Create a new scene with a specified root node type
func create_scene(params):
    print("Creating scene: " + params.scene_path)
    
    # Get project paths and log them for debugging
    var project_res_path = "res://"
    var project_user_path = "user://"
    var global_res_path = ProjectSettings.globalize_path(project_res_path)
    var global_user_path = ProjectSettings.globalize_path(project_user_path)
    
    if debug_mode:
        print("Project paths:")
        print("- res:// path: " + project_res_path)
        print("- user:// path: " + project_user_path)
        print("- Globalized res:// path: " + global_res_path)
        print("- Globalized user:// path: " + global_user_path)
        
        # Print some common environment variables for debugging
        print("Environment variables:")
        var env_vars = ["PATH", "HOME", "USER", "TEMP", "GODOT_PATH"]
        for env_var in env_vars:
            if OS.has_environment(env_var):
                print("  " + env_var + " = " + OS.get_environment(env_var))
    
    # Normalize the scene path
    var full_scene_path = params.scene_path
    if not full_scene_path.begins_with("res://"):
        full_scene_path = "res://" + full_scene_path
    if debug_mode:
        print("Scene path (with res://): " + full_scene_path)
    
    # Convert resource path to an absolute path
    var absolute_scene_path = ProjectSettings.globalize_path(full_scene_path)
    if debug_mode:
        print("Absolute scene path: " + absolute_scene_path)
    
    # Get the scene directory paths
    var scene_dir_res = full_scene_path.get_base_dir()
    var scene_dir_abs = absolute_scene_path.get_base_dir()
    if debug_mode:
        print("Scene directory (resource path): " + scene_dir_res)
        print("Scene directory (absolute path): " + scene_dir_abs)
    
    # Only do extensive testing in debug mode
    if debug_mode:
        # Try to create a simple test file in the project root to verify write access
        var initial_test_file_path = "res://godot_mcp_test_write.tmp"
        var initial_test_file = FileAccess.open(initial_test_file_path, FileAccess.WRITE)
        if initial_test_file:
            initial_test_file.store_string("Test write access")
            initial_test_file.close()
            print("Successfully wrote test file to project root: " + initial_test_file_path)
            
            # Verify the test file exists
            var initial_test_file_exists = FileAccess.file_exists(initial_test_file_path)
            print("Test file exists check: " + str(initial_test_file_exists))
            
            # Clean up the test file
            if initial_test_file_exists:
                var remove_error = DirAccess.remove_absolute(ProjectSettings.globalize_path(initial_test_file_path))
                print("Test file removal result: " + str(remove_error))
        else:
            var write_error = FileAccess.get_open_error()
            printerr("Failed to write test file to project root: " + str(write_error))
            printerr("This indicates a serious permission issue with the project directory")
    
    # Use traditional if-else statement for better compatibility
    var root_node_type = "Node2D"  # Default value
    if params.has("root_node_type"):
        root_node_type = params.root_node_type
    if debug_mode:
        print("Root node type: " + root_node_type)
    
    # Create the root node
    var scene_root = instantiate_class(root_node_type)
    if not scene_root:
        printerr("Failed to instantiate node of type: " + root_node_type)
        printerr("Make sure the class exists and can be instantiated")
        printerr("Check if the class is registered in ClassDB or available as a script")
        quit(1)
    
    scene_root.name = "root"
    if debug_mode:
        print("Root node created with name: " + scene_root.name)
    
    # Set the owner of the root node to itself (important for scene saving)
    scene_root.owner = scene_root
    
    # Pack the scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if debug_mode:
        print("Pack result: " + str(result) + " (OK=" + str(OK) + ")")
    
    if result == OK:
        # Only do extensive testing in debug mode
        if debug_mode:
            # First, let's verify we can write to the project directory
            print("Testing write access to project directory...")
            var test_write_path = "res://test_write_access.tmp"
            var test_write_abs = ProjectSettings.globalize_path(test_write_path)
            var test_file = FileAccess.open(test_write_path, FileAccess.WRITE)
            
            if test_file:
                test_file.store_string("Write test")
                test_file.close()
                print("Successfully wrote test file to project directory")
                
                # Clean up test file
                if FileAccess.file_exists(test_write_path):
                    var remove_error = DirAccess.remove_absolute(test_write_abs)
                    print("Test file removal result: " + str(remove_error))
            else:
                var write_error = FileAccess.get_open_error()
                printerr("Failed to write test file to project directory: " + str(write_error))
                printerr("This may indicate permission issues with the project directory")
                # Continue anyway, as the scene directory might still be writable
        
        # Ensure the scene directory exists using DirAccess
        if debug_mode:
            print("Ensuring scene directory exists...")
        
        # Get the scene directory relative to res://
        var scene_dir_relative = scene_dir_res.substr(6)  # Remove "res://" prefix
        if debug_mode:
            print("Scene directory (relative to res://): " + scene_dir_relative)
        
        # Create the directory if needed
        if not scene_dir_relative.is_empty():
            # First check if it exists
            var dir_exists = DirAccess.dir_exists_absolute(scene_dir_abs)
            if debug_mode:
                print("Directory exists check (absolute): " + str(dir_exists))
            
            if not dir_exists:
                if debug_mode:
                    print("Directory doesn't exist, creating: " + scene_dir_relative)
                
                # Try to create the directory using DirAccess
                var dir = DirAccess.open("res://")
                if dir == null:
                    var open_error = DirAccess.get_open_error()
                    printerr("Failed to open res:// directory: " + str(open_error))
                    
                    # Try alternative approach with absolute path
                    if debug_mode:
                        print("Trying alternative directory creation approach...")
                    var make_dir_error = DirAccess.make_dir_recursive_absolute(scene_dir_abs)
                    if debug_mode:
                        print("Make directory result (absolute): " + str(make_dir_error))
                    
                    if make_dir_error != OK:
                        printerr("Failed to create directory using absolute path")
                        printerr("Error code: " + str(make_dir_error))
                        quit(1)
                else:
                    # Create the directory using the DirAccess instance
                    if debug_mode:
                        print("Creating directory using DirAccess: " + scene_dir_relative)
                    var make_dir_error = dir.make_dir_recursive(scene_dir_relative)
                    if debug_mode:
                        print("Make directory result: " + str(make_dir_error))
                    
                    if make_dir_error != OK:
                        printerr("Failed to create directory: " + scene_dir_relative)
                        printerr("Error code: " + str(make_dir_error))
                        quit(1)
                
                # Verify the directory was created
                dir_exists = DirAccess.dir_exists_absolute(scene_dir_abs)
                if debug_mode:
                    print("Directory exists check after creation: " + str(dir_exists))
                
                if not dir_exists:
                    printerr("Directory reported as created but does not exist: " + scene_dir_abs)
                    printerr("This may indicate a problem with path resolution or permissions")
                    quit(1)
            elif debug_mode:
                print("Directory already exists: " + scene_dir_abs)
        
        # Save the scene
        if debug_mode:
            print("Saving scene to: " + full_scene_path)
        var save_error = ResourceSaver.save(packed_scene, full_scene_path)
        if debug_mode:
            print("Save result: " + str(save_error) + " (OK=" + str(OK) + ")")
        
        if save_error == OK:
            # Only do extensive testing in debug mode
            if debug_mode:
                # Wait a moment to ensure file system has time to complete the write
                print("Waiting for file system to complete write operation...")
                OS.delay_msec(500)  # 500ms delay
                
                # Verify the file was actually created using multiple methods
                var file_check_abs = FileAccess.file_exists(absolute_scene_path)
                print("File exists check (absolute path): " + str(file_check_abs))
                
                var file_check_res = FileAccess.file_exists(full_scene_path)
                print("File exists check (resource path): " + str(file_check_res))
                
                var res_exists = ResourceLoader.exists(full_scene_path)
                print("Resource exists check: " + str(res_exists))
                
                # If file doesn't exist by absolute path, try to create a test file in the same directory
                if not file_check_abs and not file_check_res:
                    printerr("Scene file not found after save. Trying to diagnose the issue...")
                    
                    # Try to write a test file to the same directory
                    var test_scene_file_path = scene_dir_res + "/test_scene_file.tmp"
                    var test_scene_file = FileAccess.open(test_scene_file_path, FileAccess.WRITE)
                    
                    if test_scene_file:
                        test_scene_file.store_string("Test scene directory write")
                        test_scene_file.close()
                        print("Successfully wrote test file to scene directory: " + test_scene_file_path)
                        
                        # Check if the test file exists
                        var test_file_exists = FileAccess.file_exists(test_scene_file_path)
                        print("Test file exists: " + str(test_file_exists))
                        
                        if test_file_exists:
                            # Directory is writable, so the issue is with scene saving
                            printerr("Directory is writable but scene file wasn't created.")
                            printerr("This suggests an issue with ResourceSaver.save() or the packed scene.")
                            
                            # Try saving with a different approach
                            print("Trying alternative save approach...")
                            var alt_save_error = ResourceSaver.save(packed_scene, test_scene_file_path + ".tscn")
                            print("Alternative save result: " + str(alt_save_error))
                            
                            # Clean up test files
                            DirAccess.remove_absolute(ProjectSettings.globalize_path(test_scene_file_path))
                            if alt_save_error == OK:
                                DirAccess.remove_absolute(ProjectSettings.globalize_path(test_scene_file_path + ".tscn"))
                        else:
                            printerr("Test file couldn't be verified. This suggests filesystem access issues.")
                    else:
                        var write_error = FileAccess.get_open_error()
                        printerr("Failed to write test file to scene directory: " + str(write_error))
                        printerr("This confirms there are permission or path issues with the scene directory.")
                    
                    # Return error since we couldn't create the scene file
                    printerr("Failed to create scene: " + params.scene_path)
                    quit(1)
                
                # If we get here, at least one of our file checks passed
                if file_check_abs or file_check_res or res_exists:
                    print("Scene file verified to exist!")
                    
                    # Try to load the scene to verify it's valid
                    var test_load = ResourceLoader.load(full_scene_path)
                    if test_load:
                        print("Scene created and verified successfully at: " + params.scene_path)
                        print("Scene file can be loaded correctly.")
                    else:
                        print("Scene file exists but cannot be loaded. It may be corrupted or incomplete.")
                        # Continue anyway since the file exists
                    
                    print("Scene created successfully at: " + params.scene_path)
                else:
                    printerr("All file existence checks failed despite successful save operation.")
                    printerr("This indicates a serious issue with file system access or path resolution.")
                    quit(1)
            else:
                # In non-debug mode, just check if the file exists
                var file_exists = FileAccess.file_exists(full_scene_path)
                if file_exists:
                    print("Scene created successfully at: " + params.scene_path)
                else:
                    printerr("Failed to create scene: " + params.scene_path)
                    quit(1)
        else:
            # Handle specific error codes
            var error_message = "Failed to save scene. Error code: " + str(save_error)
            
            if save_error == ERR_CANT_CREATE:
                error_message += " (ERR_CANT_CREATE - Cannot create the scene file)"
            elif save_error == ERR_CANT_OPEN:
                error_message += " (ERR_CANT_OPEN - Cannot open the scene file for writing)"
            elif save_error == ERR_FILE_CANT_WRITE:
                error_message += " (ERR_FILE_CANT_WRITE - Cannot write to the scene file)"
            elif save_error == ERR_FILE_NO_PERMISSION:
                error_message += " (ERR_FILE_NO_PERMISSION - No permission to write the scene file)"
            
            printerr(error_message)
            quit(1)
    else:
        printerr("Failed to pack scene: " + str(result))
        printerr("Error code: " + str(result))
        quit(1)

# Add a node to an existing scene
func add_node(params):
    print("Adding node to scene: " + params.scene_path)
    
    var full_scene_path = params.scene_path
    if not full_scene_path.begins_with("res://"):
        full_scene_path = "res://" + full_scene_path
    if debug_mode:
        print("Scene path (with res://): " + full_scene_path)
    
    var absolute_scene_path = ProjectSettings.globalize_path(full_scene_path)
    if debug_mode:
        print("Absolute scene path: " + absolute_scene_path)
    
    if not FileAccess.file_exists(absolute_scene_path):
        printerr("Scene file does not exist at: " + absolute_scene_path)
        quit(1)
    
    var scene = load(full_scene_path)
    if not scene:
        printerr("Failed to load scene: " + full_scene_path)
        quit(1)
    
    if debug_mode:
        print("Scene loaded successfully")
    var scene_root = scene.instantiate()
    if debug_mode:
        print("Scene instantiated")
    
    # Use traditional if-else statement for better compatibility
    var parent_path = "root"  # Default value
    if params.has("parent_node_path"):
        parent_path = params.parent_node_path
    if debug_mode:
        print("Parent path: " + parent_path)
    
    var parent = scene_root
    if parent_path != "root":
        parent = scene_root.get_node(parent_path.replace("root/", ""))
        if not parent:
            printerr("Parent node not found: " + parent_path)
            quit(1)
    if debug_mode:
        print("Parent node found: " + parent.name)
    
    if debug_mode:
        print("Instantiating node of type: " + params.node_type)
    var new_node = instantiate_class(params.node_type)
    if not new_node:
        printerr("Failed to instantiate node of type: " + params.node_type)
        printerr("Make sure the class exists and can be instantiated")
        printerr("Check if the class is registered in ClassDB or available as a script")
        quit(1)
    new_node.name = params.node_name
    if debug_mode:
        print("New node created with name: " + new_node.name)
    
    if params.has("properties"):
        if debug_mode:
            print("Setting properties on node")
        var properties = params.properties
        for property in properties:
            if debug_mode:
                print("Setting property: " + property + " = " + str(properties[property]))
            new_node.set(property, properties[property])
    
    parent.add_child(new_node)
    new_node.owner = scene_root
    if debug_mode:
        print("Node added to parent and ownership set")
    
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if debug_mode:
        print("Pack result: " + str(result) + " (OK=" + str(OK) + ")")
    
    if result == OK:
        if debug_mode:
            print("Saving scene to: " + absolute_scene_path)
        var save_error = ResourceSaver.save(packed_scene, absolute_scene_path)
        if debug_mode:
            print("Save result: " + str(save_error) + " (OK=" + str(OK) + ")")
        if save_error == OK:
            if debug_mode:
                var file_check_after = FileAccess.file_exists(absolute_scene_path)
                print("File exists check after save: " + str(file_check_after))
                if file_check_after:
                    print("Node '" + params.node_name + "' of type '" + params.node_type + "' added successfully")
                else:
                    printerr("File reported as saved but does not exist at: " + absolute_scene_path)
            else:
                print("Node '" + params.node_name + "' of type '" + params.node_type + "' added successfully")
        else:
            printerr("Failed to save scene: " + str(save_error))
    else:
        printerr("Failed to pack scene: " + str(result))

# Load a sprite into a Sprite2D node
func load_sprite(params):
    print("Loading sprite into scene: " + params.scene_path)
    
    # Ensure the scene path starts with res:// for Godot's resource system
    var full_scene_path = params.scene_path
    if not full_scene_path.begins_with("res://"):
        full_scene_path = "res://" + full_scene_path
    
    if debug_mode:
        print("Full scene path (with res://): " + full_scene_path)
    
    # Check if the scene file exists
    var file_check = FileAccess.file_exists(full_scene_path)
    if debug_mode:
        print("Scene file exists check: " + str(file_check))
    
    if not file_check:
        printerr("Scene file does not exist at: " + full_scene_path)
        # Get the absolute path for reference
        var absolute_path = ProjectSettings.globalize_path(full_scene_path)
        printerr("Absolute file path that doesn't exist: " + absolute_path)
        quit(1)
    
    # Ensure the texture path starts with res:// for Godot's resource system
    var full_texture_path = params.texture_path
    if not full_texture_path.begins_with("res://"):
        full_texture_path = "res://" + full_texture_path
    
    if debug_mode:
        print("Full texture path (with res://): " + full_texture_path)
    
    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        printerr("Failed to load scene: " + full_scene_path)
        quit(1)
    
    if debug_mode:
        print("Scene loaded successfully")
    
    # Instance the scene
    var scene_root = scene.instantiate()
    if debug_mode:
        print("Scene instantiated")
    
    # Find the sprite node
    var node_path = params.node_path
    if debug_mode:
        print("Original node path: " + node_path)
    
    if node_path.begins_with("root/"):
        node_path = node_path.substr(5)  # Remove "root/" prefix
        if debug_mode:
            print("Node path after removing 'root/' prefix: " + node_path)
    
    var sprite_node = null
    if node_path == "":
        # If no node path, assume root is the sprite
        sprite_node = scene_root
        if debug_mode:
            print("Using root node as sprite node")
    else:
        sprite_node = scene_root.get_node(node_path)
        if sprite_node and debug_mode:
            print("Found sprite node: " + sprite_node.name)
    
    if not sprite_node:
        printerr("Node not found: " + params.node_path)
        quit(1)
    
    # Check if the node is a Sprite2D or compatible type
    if debug_mode:
        print("Node class: " + sprite_node.get_class())
    if not (sprite_node is Sprite2D or sprite_node is Sprite3D or sprite_node is TextureRect):
        printerr("Node is not a sprite-compatible type: " + sprite_node.get_class())
        quit(1)
    
    # Load the texture
    if debug_mode:
        print("Loading texture from: " + full_texture_path)
    var texture = load(full_texture_path)
    if not texture:
        printerr("Failed to load texture: " + full_texture_path)
        quit(1)
    
    if debug_mode:
        print("Texture loaded successfully")
    
    # Set the texture on the sprite
    if sprite_node is Sprite2D or sprite_node is Sprite3D:
        sprite_node.texture = texture
        if debug_mode:
            print("Set texture on Sprite2D/Sprite3D node")
    elif sprite_node is TextureRect:
        sprite_node.texture = texture
        if debug_mode:
            print("Set texture on TextureRect node")
    
    # Save the modified scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if debug_mode:
        print("Pack result: " + str(result) + " (OK=" + str(OK) + ")")
    
    if result == OK:
        if debug_mode:
            print("Saving scene to: " + full_scene_path)
        var error = ResourceSaver.save(packed_scene, full_scene_path)
        if debug_mode:
            print("Save result: " + str(error) + " (OK=" + str(OK) + ")")
        
        if error == OK:
            # Verify the file was actually updated
            if debug_mode:
                var file_check_after = FileAccess.file_exists(full_scene_path)
                print("File exists check after save: " + str(file_check_after))
                
                if file_check_after:
                    print("Sprite loaded successfully with texture: " + full_texture_path)
                    # Get the absolute path for reference
                    var absolute_path = ProjectSettings.globalize_path(full_scene_path)
                    print("Absolute file path: " + absolute_path)
                else:
                    printerr("File reported as saved but does not exist at: " + full_scene_path)
            else:
                print("Sprite loaded successfully with texture: " + full_texture_path)
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))

# Export a scene as a MeshLibrary resource
func export_mesh_library(params):
    print("Exporting MeshLibrary from scene: " + params.scene_path)
    
    # Ensure the scene path starts with res:// for Godot's resource system
    var full_scene_path = params.scene_path
    if not full_scene_path.begins_with("res://"):
        full_scene_path = "res://" + full_scene_path
    
    if debug_mode:
        print("Full scene path (with res://): " + full_scene_path)
    
    # Ensure the output path starts with res:// for Godot's resource system
    var full_output_path = params.output_path
    if not full_output_path.begins_with("res://"):
        full_output_path = "res://" + full_output_path
    
    if debug_mode:
        print("Full output path (with res://): " + full_output_path)
    
    # Check if the scene file exists
    var file_check = FileAccess.file_exists(full_scene_path)
    if debug_mode:
        print("Scene file exists check: " + str(file_check))
    
    if not file_check:
        printerr("Scene file does not exist at: " + full_scene_path)
        # Get the absolute path for reference
        var absolute_path = ProjectSettings.globalize_path(full_scene_path)
        printerr("Absolute file path that doesn't exist: " + absolute_path)
        quit(1)
    
    # Load the scene
    if debug_mode:
        print("Loading scene from: " + full_scene_path)
    var scene = load(full_scene_path)
    if not scene:
        printerr("Failed to load scene: " + full_scene_path)
        quit(1)
    
    if debug_mode:
        print("Scene loaded successfully")
    
    # Instance the scene
    var scene_root = scene.instantiate()
    if debug_mode:
        print("Scene instantiated")
    
    # Create a new MeshLibrary
    var mesh_library = MeshLibrary.new()
    if debug_mode:
        print("Created new MeshLibrary")
    
    # Get mesh item names if provided
    var mesh_item_names = params.mesh_item_names if params.has("mesh_item_names") else []
    var use_specific_items = mesh_item_names.size() > 0
    
    if debug_mode:
        if use_specific_items:
            print("Using specific mesh items: " + str(mesh_item_names))
        else:
            print("Using all mesh items in the scene")
    
    # Process all child nodes
    var item_id = 0
    if debug_mode:
        print("Processing child nodes...")
    
    for child in scene_root.get_children():
        if debug_mode:
            print("Checking child node: " + child.name)
        
        # Skip if not using all items and this item is not in the list
        if use_specific_items and not (child.name in mesh_item_names):
            if debug_mode:
                print("Skipping node " + child.name + " (not in specified items list)")
            continue
            
        # Check if the child has a mesh
        var mesh_instance = null
        if child is MeshInstance3D:
            mesh_instance = child
            if debug_mode:
                print("Node " + child.name + " is a MeshInstance3D")
        else:
            # Try to find a MeshInstance3D in the child's descendants
            if debug_mode:
                print("Searching for MeshInstance3D in descendants of " + child.name)
            for descendant in child.get_children():
                if descendant is MeshInstance3D:
                    mesh_instance = descendant
                    if debug_mode:
                        print("Found MeshInstance3D in descendant: " + descendant.name)
                    break
        
        if mesh_instance and mesh_instance.mesh:
            if debug_mode:
                print("Adding mesh: " + child.name)
            
            # Add the mesh to the library
            mesh_library.create_item(item_id)
            mesh_library.set_item_name(item_id, child.name)
            mesh_library.set_item_mesh(item_id, mesh_instance.mesh)
            if debug_mode:
                print("Added mesh to library with ID: " + str(item_id))
            
            # Add collision shape if available
            var collision_added = false
            for collision_child in child.get_children():
                if collision_child is CollisionShape3D and collision_child.shape:
                    mesh_library.set_item_shapes(item_id, [collision_child.shape])
                    if debug_mode:
                        print("Added collision shape from: " + collision_child.name)
                    collision_added = true
                    break
            
            if debug_mode and not collision_added:
                print("No collision shape found for mesh: " + child.name)
            
            # Add preview if available
            if mesh_instance.mesh:
                mesh_library.set_item_preview(item_id, mesh_instance.mesh)
                if debug_mode:
                    print("Added preview for mesh: " + child.name)
            
            item_id += 1
        elif debug_mode:
            print("Node " + child.name + " has no valid mesh")
    
    if debug_mode:
        print("Processed " + str(item_id) + " meshes")
    
    # Create directory if it doesn't exist
    var dir = DirAccess.open("res://")
    if dir == null:
        printerr("Failed to open res:// directory")
        printerr("DirAccess error: " + str(DirAccess.get_open_error()))
        quit(1)
        
    var output_dir = full_output_path.get_base_dir()
    if debug_mode:
        print("Output directory: " + output_dir)
    
    if output_dir != "res://" and not dir.dir_exists(output_dir.substr(6)):  # Remove "res://" prefix
        if debug_mode:
            print("Creating directory: " + output_dir)
        var error = dir.make_dir_recursive(output_dir.substr(6))  # Remove "res://" prefix
        if error != OK:
            printerr("Failed to create directory: " + output_dir + ", error: " + str(error))
            quit(1)
    
    # Save the mesh library
    if item_id > 0:
        if debug_mode:
            print("Saving MeshLibrary to: " + full_output_path)
        var error = ResourceSaver.save(mesh_library, full_output_path)
        if debug_mode:
            print("Save result: " + str(error) + " (OK=" + str(OK) + ")")
        
        if error == OK:
            # Verify the file was actually created
            if debug_mode:
                var file_check_after = FileAccess.file_exists(full_output_path)
                print("File exists check after save: " + str(file_check_after))
                
                if file_check_after:
                    print("MeshLibrary exported successfully with " + str(item_id) + " items to: " + full_output_path)
                    # Get the absolute path for reference
                    var absolute_path = ProjectSettings.globalize_path(full_output_path)
                    print("Absolute file path: " + absolute_path)
                else:
                    printerr("File reported as saved but does not exist at: " + full_output_path)
            else:
                print("MeshLibrary exported successfully with " + str(item_id) + " items to: " + full_output_path)
        else:
            printerr("Failed to save MeshLibrary: " + str(error))
    else:
        printerr("No valid meshes found in the scene")

# Find files with a specific extension recursively
func find_files(path, extension):
    var files = []
    var dir = DirAccess.open(path)
    
    if dir:
        dir.list_dir_begin()
        var file_name = dir.get_next()
        
        while file_name != "":
            if dir.current_is_dir() and not file_name.begins_with("."):
                files.append_array(find_files(path + file_name + "/", extension))
            elif file_name.ends_with(extension):
                files.append(path + file_name)
            
            file_name = dir.get_next()
    
    return files

# Get UID for a specific file
func get_uid(params):
    if not params.has("file_path"):
        printerr("File path is required")
        quit(1)
    
    # Ensure the file path starts with res:// for Godot's resource system
    var file_path = params.file_path
    if not file_path.begins_with("res://"):
        file_path = "res://" + file_path
    
    print("Getting UID for file: " + file_path)
    if debug_mode:
        print("Full file path (with res://): " + file_path)
    
    # Get the absolute path for reference
    var absolute_path = ProjectSettings.globalize_path(file_path)
    if debug_mode:
        print("Absolute file path: " + absolute_path)
    
    # Ensure the file exists
    var file_check = FileAccess.file_exists(file_path)
    if debug_mode:
        print("File exists check: " + str(file_check))
    
    if not file_check:
        printerr("File does not exist at: " + file_path)
        printerr("Absolute file path that doesn't exist: " + absolute_path)
        quit(1)
    
    # Check if the UID file exists
    var uid_path = file_path + ".uid"
    if debug_mode:
        print("UID file path: " + uid_path)
    
    var uid_check = FileAccess.file_exists(uid_path)
    if debug_mode:
        print("UID file exists check: " + str(uid_check))
    
    var f = FileAccess.open(uid_path, FileAccess.READ)
    
    if f:
        # Read the UID content
        var uid_content = f.get_as_text()
        f.close()
        if debug_mode:
            print("UID content read successfully")
        
        # Return the UID content
        var result = {
            "file": file_path,
            "absolutePath": absolute_path,
            "uid": uid_content.strip_edges(),
            "exists": true
        }
        if debug_mode:
            print("UID result: " + JSON.stringify(result))
        print(JSON.stringify(result))
    else:
        if debug_mode:
            print("UID file does not exist or could not be opened")
        
        # UID file doesn't exist
        var result = {
            "file": file_path,
            "absolutePath": absolute_path,
            "exists": false,
            "message": "UID file does not exist for this file. Use resave_resources to generate UIDs."
        }
        if debug_mode:
            print("UID result: " + JSON.stringify(result))
        print(JSON.stringify(result))

# Resave all resources to update UID references
func resave_resources(params):
    print("Resaving all resources to update UID references...")
    
    # Get project path if provided
    var project_path = "res://"
    if params.has("project_path"):
        project_path = params.project_path
        if not project_path.begins_with("res://"):
            project_path = "res://" + project_path
        if not project_path.ends_with("/"):
            project_path += "/"
    
    if debug_mode:
        print("Using project path: " + project_path)
    
    # Get all .tscn files
    if debug_mode:
        print("Searching for scene files in: " + project_path)
    var scenes = find_files(project_path, ".tscn")
    if debug_mode:
        print("Found " + str(scenes.size()) + " scenes")
    
    # Resave each scene
    var success_count = 0
    var error_count = 0
    
    for scene_path in scenes:
        if debug_mode:
            print("Processing scene: " + scene_path)
        
        # Check if the scene file exists
        var file_check = FileAccess.file_exists(scene_path)
        if debug_mode:
            print("Scene file exists check: " + str(file_check))
        
        if not file_check:
            printerr("Scene file does not exist at: " + scene_path)
            error_count += 1
            continue
        
        # Load the scene
        var scene = load(scene_path)
        if scene:
            if debug_mode:
                print("Scene loaded successfully, saving...")
            var error = ResourceSaver.save(scene, scene_path)
            if debug_mode:
                print("Save result: " + str(error) + " (OK=" + str(OK) + ")")
            
            if error == OK:
                success_count += 1
                if debug_mode:
                    print("Scene saved successfully: " + scene_path)
                
                    # Verify the file was actually updated
                    var file_check_after = FileAccess.file_exists(scene_path)
                    print("File exists check after save: " + str(file_check_after))
                
                    if not file_check_after:
                        printerr("File reported as saved but does not exist at: " + scene_path)
            else:
                error_count += 1
                printerr("Failed to save: " + scene_path + ", error: " + str(error))
        else:
            error_count += 1
            printerr("Failed to load: " + scene_path)
    
    # Get all .gd and .shader files
    if debug_mode:
        print("Searching for script and shader files in: " + project_path)
    var scripts = find_files(project_path, ".gd") + find_files(project_path, ".shader") + find_files(project_path, ".gdshader")
    if debug_mode:
        print("Found " + str(scripts.size()) + " scripts/shaders")
    
    # Check for missing .uid files
    var missing_uids = 0
    var generated_uids = 0
    
    for script_path in scripts:
        if debug_mode:
            print("Checking UID for: " + script_path)
        var uid_path = script_path + ".uid"
        
        var uid_check = FileAccess.file_exists(uid_path)
        if debug_mode:
            print("UID file exists check: " + str(uid_check))
        
        var f = FileAccess.open(uid_path, FileAccess.READ)
        if not f:
            missing_uids += 1
            if debug_mode:
                print("Missing UID file for: " + script_path + ", generating...")
            
            # Force a save to generate UID
            var res = load(script_path)
            if res:
                var error = ResourceSaver.save(res, script_path)
                if debug_mode:
                    print("Save result: " + str(error) + " (OK=" + str(OK) + ")")
                
                if error == OK:
                    generated_uids += 1
                    if debug_mode:
                        print("Generated UID for: " + script_path)
                    
                        # Verify the UID file was actually created
                        var uid_check_after = FileAccess.file_exists(uid_path)
                        print("UID file exists check after save: " + str(uid_check_after))
                    
                        if not uid_check_after:
                            printerr("UID file reported as generated but does not exist at: " + uid_path)
                else:
                    printerr("Failed to generate UID for: " + script_path + ", error: " + str(error))
            else:
                printerr("Failed to load resource: " + script_path)
        elif debug_mode:
            print("UID file already exists for: " + script_path)
    
    if debug_mode:
        print("Summary:")
        print("- Scenes processed: " + str(scenes.size()))
        print("- Scenes successfully saved: " + str(success_count))
        print("- Scenes with errors: " + str(error_count))
        print("- Scripts/shaders missing UIDs: " + str(missing_uids))
        print("- UIDs successfully generated: " + str(generated_uids))
    print("Resave operation complete")

# Save changes to a scene file
func save_scene(params):
    print("Saving scene: " + params.scene_path)
    
    # Ensure the scene path starts with res:// for Godot's resource system
    var full_scene_path = params.scene_path
    if not full_scene_path.begins_with("res://"):
        full_scene_path = "res://" + full_scene_path
    
    if debug_mode:
        print("Full scene path (with res://): " + full_scene_path)
    
    # Check if the scene file exists
    var file_check = FileAccess.file_exists(full_scene_path)
    if debug_mode:
        print("Scene file exists check: " + str(file_check))
    
    if not file_check:
        printerr("Scene file does not exist at: " + full_scene_path)
        # Get the absolute path for reference
        var absolute_path = ProjectSettings.globalize_path(full_scene_path)
        printerr("Absolute file path that doesn't exist: " + absolute_path)
        quit(1)
    
    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        printerr("Failed to load scene: " + full_scene_path)
        quit(1)
    
    if debug_mode:
        print("Scene loaded successfully")
    
    # Instance the scene
    var scene_root = scene.instantiate()
    if debug_mode:
        print("Scene instantiated")
    
    # Determine save path
    var save_path = params.new_path if params.has("new_path") else full_scene_path
    if params.has("new_path") and not save_path.begins_with("res://"):
        save_path = "res://" + save_path
    
    if debug_mode:
        print("Save path: " + save_path)
    
    # Create directory if it doesn't exist
    if params.has("new_path"):
        var dir = DirAccess.open("res://")
        if dir == null:
            printerr("Failed to open res:// directory")
            printerr("DirAccess error: " + str(DirAccess.get_open_error()))
            quit(1)
            
        var scene_dir = save_path.get_base_dir()
        if debug_mode:
            print("Scene directory: " + scene_dir)
        
        if scene_dir != "res://" and not dir.dir_exists(scene_dir.substr(6)):  # Remove "res://" prefix
            if debug_mode:
                print("Creating directory: " + scene_dir)
            var error = dir.make_dir_recursive(scene_dir.substr(6))  # Remove "res://" prefix
            if error != OK:
                printerr("Failed to create directory: " + scene_dir + ", error: " + str(error))
                quit(1)
    
    # Create a packed scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if debug_mode:
        print("Pack result: " + str(result) + " (OK=" + str(OK) + ")")
    
    if result == OK:
        if debug_mode:
            print("Saving scene to: " + save_path)
        var error = ResourceSaver.save(packed_scene, save_path)
        if debug_mode:
            print("Save result: " + str(error) + " (OK=" + str(OK) + ")")
        
        if error == OK:
            # Verify the file was actually created/updated
            if debug_mode:
                var file_check_after = FileAccess.file_exists(save_path)
                print("File exists check after save: " + str(file_check_after))
                
                if file_check_after:
                    print("Scene saved successfully to: " + save_path)
                    # Get the absolute path for reference
                    var absolute_path = ProjectSettings.globalize_path(save_path)
                    print("Absolute file path: " + absolute_path)
                else:
                    printerr("File reported as saved but does not exist at: " + save_path)
            else:
                print("Scene saved successfully to: " + save_path)
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))

# Helper: ensure a path starts with res://
func ensure_res_prefix(path: String) -> String:
    if not path.begins_with("res://"):
        return "res://" + path
    return path

# Helper: convert a JSON value to the appropriate Godot type based on type_hint
func convert_json_to_godot_type(value, type_hint: String):
    match type_hint:
        "Vector2":
            return Vector2(value.x, value.y)
        "Vector3":
            return Vector3(value.x, value.y, value.z)
        "Color":
            var a = value.a if value.has("a") else 1.0
            return Color(value.r, value.g, value.b, a)
        "bool":
            return bool(value)
        "int":
            return int(value)
        "float":
            return float(value)
        _:
            return value

# Modify a property on a node in a scene
func modify_node_property(params):
    print("Modifying node property in scene: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)
    if debug_mode:
        print("Full scene path: " + full_scene_path)

    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    if debug_mode:
        print("Scene loaded successfully")

    # Instantiate the scene
    var scene_root = scene.instantiate()
    if debug_mode:
        print("Scene instantiated")

    # Navigate to the target node
    var node_path = params.node_path
    if debug_mode:
        print("Original node path: " + node_path)

    var target = find_node_by_path(scene_root, node_path)

    if not target:
        log_error("Node not found: " + params.node_path)
        quit(1)

    if debug_mode:
        print("Target node found: " + target.name)

    # Convert the value to the correct Godot type
    var type_hint = params.value_type if params.has("value_type") else ""
    var converted_value = convert_json_to_godot_type(params.value, type_hint)
    if debug_mode:
        print("Setting property '" + params.property_name + "' to: " + str(converted_value))

    # Set the property
    target.set(params.property_name, converted_value)

    # Re-pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if debug_mode:
        print("Pack result: " + str(result) + " (OK=" + str(OK) + ")")

    if result != OK:
        log_error("Failed to pack scene after modification: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if debug_mode:
        print("Save result: " + str(save_error) + " (OK=" + str(OK) + ")")

    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    var result_json = {
        "success": true,
        "node": params.node_path,
        "property": params.property_name,
        "value": str(converted_value)
    }
    print(JSON.stringify(result_json))

# Remove a node from a scene by path
func remove_node(params):
    print("Removing node from scene: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)
    if debug_mode:
        print("Full scene path: " + full_scene_path)

    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    if debug_mode:
        print("Scene loaded successfully")

    # Instantiate the scene
    var scene_root = scene.instantiate()
    if debug_mode:
        print("Scene instantiated")

    # Navigate to the target node
    var node_path = params.node_path
    if debug_mode:
        print("Original node path: " + node_path)

    # Guard: cannot remove root node
    if node_path == "root" or node_path == "":
        log_error("Cannot remove the root node")
        quit(1)
    if node_path.begins_with("root/") and node_path.substr(5) == "":
        log_error("Cannot remove the root node")
        quit(1)

    var target = find_node_by_path(scene_root, node_path)

    if not target:
        log_error("Node not found: " + params.node_path)
        quit(1)

    if debug_mode:
        print("Target node found: " + target.name)

    # Remove the node
    target.get_parent().remove_child(target)
    target.queue_free()
    if debug_mode:
        print("Node removed")

    # Re-pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if debug_mode:
        print("Pack result: " + str(result) + " (OK=" + str(OK) + ")")

    if result != OK:
        log_error("Failed to pack scene after removal: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if debug_mode:
        print("Save result: " + str(save_error) + " (OK=" + str(OK) + ")")

    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    var result_json = {
        "success": true,
        "removed": params.node_path
    }
    print(JSON.stringify(result_json))

# Attach a GDScript file to a node in a scene
func attach_script(params):
    print("Attaching script to node in scene: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)
    if debug_mode:
        print("Full scene path: " + full_scene_path)

    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    if debug_mode:
        print("Scene loaded successfully")

    # Instantiate the scene
    var scene_root = scene.instantiate()
    if debug_mode:
        print("Scene instantiated")

    # Navigate to the target node
    var node_path = params.node_path
    if debug_mode:
        print("Original node path: " + node_path)

    var target = find_node_by_path(scene_root, node_path)

    if not target:
        log_error("Node not found: " + params.node_path)
        quit(1)

    if debug_mode:
        print("Target node found: " + target.name)

    # Load the script
    var full_script_path = ensure_res_prefix(params.script_path)
    if debug_mode:
        print("Full script path: " + full_script_path)

    var script = load(full_script_path)
    if not script:
        log_error("Failed to load script: " + full_script_path)
        quit(1)

    if debug_mode:
        print("Script loaded successfully")

    # Attach the script to the node
    target.set_script(script)
    if debug_mode:
        print("Script attached to node")

    # Re-pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if debug_mode:
        print("Pack result: " + str(result) + " (OK=" + str(OK) + ")")

    if result != OK:
        log_error("Failed to pack scene after attaching script: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if debug_mode:
        print("Save result: " + str(save_error) + " (OK=" + str(OK) + ")")

    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    var result_json = {
        "success": true,
        "node": params.node_path,
        "script": params.script_path
    }
    print(JSON.stringify(result_json))

# Create a new resource file (.tres) with specified type and properties
func create_resource(params):
    var resource_type = params.resource_type
    var output_path = ensure_res_prefix(params.output_path)

    log_info("Creating resource of type: " + resource_type + " at: " + output_path)

    # Validate the resource type exists and is a Resource subclass
    if not ClassDB.class_exists(resource_type):
        log_error("Unknown resource type: " + resource_type)
        quit(1)

    if not ClassDB.is_parent_class(resource_type, "Resource"):
        log_error("Type is not a Resource: " + resource_type)
        quit(1)

    var resource = ClassDB.instantiate(resource_type)
    if resource == null:
        log_error("Failed to instantiate resource type: " + resource_type)
        quit(1)

    # Set properties from params
    if params.has("properties"):
        var property_types = params.get("property_types", {})
        for prop_name in params.properties:
            var value = convert_json_to_godot_type(
                params.properties[prop_name],
                property_types.get(prop_name, "")
            )
            resource.set(prop_name, value)

    # Ensure the output directory exists
    var dir_path = output_path.get_base_dir()
    if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(dir_path)):
        var dir = DirAccess.open("res://")
        if dir:
            var relative_dir = dir_path.substr(6)  # Remove "res://" prefix
            if not relative_dir.is_empty():
                dir.make_dir_recursive(relative_dir)

    var error = ResourceSaver.save(resource, output_path)
    if error == OK:
        print(JSON.stringify({"success": true, "path": output_path, "type": resource_type}))
    else:
        log_error("Failed to save resource: " + str(error))
        quit(1)

# Batch-validate all GDScript files in a project for parse errors
func validate_scripts(params):
    var base_path = params.get("path_filter", "res://")
    if base_path == "":
        base_path = "res://"
    if not base_path.begins_with("res://"):
        base_path = "res://" + base_path

    log_info("Validating scripts in: " + base_path)

    var gd_files = find_gd_files(base_path)
    var results = []
    var error_count = 0

    for file_path in gd_files:
        var script = load(file_path)
        if script == null:
            results.append({"file": file_path, "valid": false, "error": "Failed to load script"})
            error_count += 1
            continue
        var reload_result = script.reload()
        if reload_result != OK:
            results.append({"file": file_path, "valid": false, "error": "Parse error (code: " + str(reload_result) + ")"})
            error_count += 1
        else:
            results.append({"file": file_path, "valid": true})

    print(JSON.stringify({
        "results": results,
        "total": gd_files.size(),
        "errors": error_count,
        "valid": gd_files.size() - error_count
    }))

# Recursively find all .gd files under a base path
func find_gd_files(base_path: String) -> Array:
    var files = []
    var dir = DirAccess.open(base_path)
    if dir == null:
        return files
    dir.list_dir_begin()
    var file_name = dir.get_next()
    while file_name != "":
        var full_path = base_path.path_join(file_name)
        if dir.current_is_dir():
            if file_name != "." and file_name != ".." and file_name != ".godot":
                files.append_array(find_gd_files(full_path))
        elif file_name.ends_with(".gd"):
            files.append(full_path)
        file_name = dir.get_next()
    dir.list_dir_end()
    return files

# Modify a project.godot setting using ConfigFile API
# Uses ConfigFile (NOT ProjectSettings.save()) to preserve all values including default-equal ones
func modify_project_setting(params):
    var section = params.get("section", "")
    var key = params.get("key", "")
    var value = params.get("value", "")
    var action = params.get("action", "set")

    if section == "":
        log_error("Missing required parameter: section")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: section"}))
        return

    if key == "":
        log_error("Missing required parameter: key")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: key"}))
        return

    var config = ConfigFile.new()
    var err = config.load("res://project.godot")
    if err != OK:
        log_error("Failed to load project.godot: error code " + str(err))
        print(JSON.stringify({"success": false, "error": "Failed to load project.godot: error code " + str(err)}))
        return

    if action == "delete":
        config.erase_section_key(section, key)
        log_info("Deleted key: [" + section + "] " + key)
    else:
        config.set_value(section, key, value)
        log_info("Set key: [" + section + "] " + key + " = " + str(value))

    err = config.save("res://project.godot")
    if err != OK:
        log_error("Failed to save project.godot: error code " + str(err))
        print(JSON.stringify({"success": false, "error": "Failed to save project.godot: error code " + str(err)}))
        return

    print(JSON.stringify({
        "success": true,
        "section": section,
        "key": key,
        "action": action
    }))

# List all GDScript files in a project with introspection data
# Returns per-script: path, class_name, methods, properties, signals
func list_scripts(params):
    var base_path = params.get("path_filter", "res://")
    if base_path == "":
        base_path = "res://"
    if not base_path.begins_with("res://"):
        base_path = "res://" + base_path

    log_info("Listing scripts in: " + base_path)

    var gd_files = find_gd_files(base_path)
    var scripts_data = []

    for file_path in gd_files:
        var script = load(file_path)
        if script == null:
            log_error("Failed to load script: " + file_path)
            continue

        var gd_script = script as GDScript
        if gd_script == null:
            log_error("Not a GDScript: " + file_path)
            continue

        # Extract class name
        var script_class_name = ""
        if gd_script.has_method("get_global_name"):
            script_class_name = gd_script.get_global_name()

        # Extract methods (filter: skip names starting with _)
        var methods = []
        for method in gd_script.get_script_method_list():
            var method_name = method["name"]
            if not method_name.begins_with("_"):
                methods.append({
                    "name": method_name,
                    "args": method["args"].size()
                })

        # Extract properties (filter: PROPERTY_USAGE_SCRIPT_VARIABLE)
        var properties = []
        for prop in gd_script.get_script_property_list():
            if prop["usage"] & PROPERTY_USAGE_SCRIPT_VARIABLE:
                properties.append({
                    "name": prop["name"],
                    "type": prop["type"]
                })

        # Extract signals
        var signals = []
        for sig in gd_script.get_script_signal_list():
            signals.append({
                "name": sig["name"],
                "args": sig["args"].size()
            })

        scripts_data.append({
            "path": file_path,
            "class_name": script_class_name,
            "methods": methods,
            "properties": properties,
            "signals": signals
        })

    print(JSON.stringify({
        "scripts": scripts_data,
        "total": scripts_data.size()
    }))

# Query Godot ClassDB for a class's properties, methods, and signals
func query_class(params):
    var class_name_param = params.get("class_name", "")
    var no_inheritance = params.get("no_inheritance", false)

    if class_name_param == "":
        log_error("Missing required parameter: class_name")
        print(JSON.stringify({"error": "Missing required parameter: class_name"}))
        return

    if not ClassDB.class_exists(class_name_param):
        log_error("Class does not exist: " + class_name_param)
        print(JSON.stringify({"error": "Class does not exist: " + class_name_param}))
        return

    var parent_class = ClassDB.get_parent_class(class_name_param)

    # Get properties
    var properties = []
    for prop in ClassDB.class_get_property_list(class_name_param, no_inheritance):
        properties.append({
            "name": prop["name"],
            "type": prop["type"],
            "usage": prop["usage"]
        })

    # Get methods
    var methods = []
    for method in ClassDB.class_get_method_list(class_name_param, no_inheritance):
        var args = []
        for arg in method["args"]:
            args.append({
                "name": arg["name"],
                "type": arg["type"]
            })
        methods.append({
            "name": method["name"],
            "return_type": method["return"]["type"],
            "args": args
        })

    # Get signals
    var signals = []
    for sig in ClassDB.class_get_signal_list(class_name_param, no_inheritance):
        var sig_args = []
        for arg in sig["args"]:
            sig_args.append({
                "name": arg["name"],
                "type": arg["type"]
            })
        signals.append({
            "name": sig["name"],
            "args": sig_args
        })

    print(JSON.stringify({
        "class_name": class_name_param,
        "parent_class": parent_class,
        "properties": properties,
        "methods": methods,
        "signals": signals
    }))

# Connect a signal between two nodes in a scene
func connect_signal(params):
    log_info("Connecting signal in scene: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)

    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    var scene_root = scene.instantiate()

    # Find source and target nodes
    var source = find_node_by_path(scene_root, params.source_node_path)
    if not source:
        log_error("Source node not found: " + params.source_node_path)
        quit(1)

    var target = find_node_by_path(scene_root, params.target_node_path)
    if not target:
        log_error("Target node not found: " + params.target_node_path)
        quit(1)

    # Verify signal exists on source node
    if not source.has_signal(params.signal_name):
        var available_signals = []
        for sig in source.get_signal_list():
            available_signals.append(sig["name"])
        log_error("Signal '" + params.signal_name + "' does not exist on node. Available signals: " + str(available_signals))
        quit(1)

    # Connect with CONNECT_PERSIST flag (value 2) for .tscn serialization
    source[params.signal_name].connect(Callable(target, params.method_name), CONNECT_PERSIST)

    # Pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if result != OK:
        log_error("Failed to pack scene after connecting signal: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    print(JSON.stringify({
        "success": true,
        "signal": params.signal_name,
        "from": params.source_node_path,
        "to": params.target_node_path,
        "method": params.method_name
    }))

# Disconnect a signal between two nodes in a scene
func disconnect_signal(params):
    log_info("Disconnecting signal in scene: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)

    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    var scene_root = scene.instantiate()

    # Find source and target nodes
    var source = find_node_by_path(scene_root, params.source_node_path)
    if not source:
        log_error("Source node not found: " + params.source_node_path)
        quit(1)

    var target = find_node_by_path(scene_root, params.target_node_path)
    if not target:
        log_error("Target node not found: " + params.target_node_path)
        quit(1)

    # Check connection exists
    if not source.is_connected(params.signal_name, Callable(target, params.method_name)):
        log_error("Signal not connected: " + params.signal_name + " from " + params.source_node_path + " to " + params.target_node_path + "::" + params.method_name)
        quit(1)

    # Disconnect the signal
    source.disconnect(params.signal_name, Callable(target, params.method_name))

    # Pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if result != OK:
        log_error("Failed to pack scene after disconnecting signal: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    print(JSON.stringify({
        "success": true,
        "disconnected": params.signal_name
    }))

# Instance a child scene under a parent node in a scene
func instance_scene(params):
    log_info("Instancing scene in: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)

    # Load the parent scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    var scene_root = scene.instantiate()

    # Find parent node
    var parent = find_node_by_path(scene_root, params.parent_node_path)
    if not parent:
        log_error("Parent node not found: " + params.parent_node_path)
        quit(1)

    # Load child scene
    var child_packed = load(ensure_res_prefix(params.child_scene_path)) as PackedScene
    if not child_packed:
        log_error("Failed to load child scene: " + params.child_scene_path)
        quit(1)

    var child_instance = child_packed.instantiate()

    # Optionally rename the child instance
    if params.has("node_name") and not params.node_name.is_empty():
        child_instance.name = params.node_name

    # Add child to parent
    parent.add_child(child_instance)

    # CRITICAL: Set owner to scene root (NOT parent) for correct pack() behavior
    child_instance.owner = scene_root

    # Pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if result != OK:
        log_error("Failed to pack scene after instancing: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    print(JSON.stringify({
        "success": true,
        "instanced": params.child_scene_path,
        "parent": params.parent_node_path,
        "name": child_instance.name
    }))

# Batch set properties on multiple nodes in a single scene save
func batch_set_properties(params):
    log_info("Batch setting properties in scene: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)

    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    var scene_root = scene.instantiate()

    var operations = params.operations

    # Validation pass first (fail-fast): check ALL node paths before applying any changes
    for op in operations:
        var target = find_node_by_path(scene_root, op.node_path)
        if not target:
            log_error("Node not found during validation: " + op.node_path)
            quit(1)

    # Apply pass: set properties on each node
    for op in operations:
        var target = find_node_by_path(scene_root, op.node_path)
        var type_hint = op.value_type if op.has("value_type") else ""
        var converted_value = convert_json_to_godot_type(op.value, type_hint)
        target.set(op.property_name, converted_value)

    # Single pack and save at the end
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if result != OK:
        log_error("Failed to pack scene after batch property set: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    print(JSON.stringify({
        "success": true,
        "operations_applied": operations.size()
    }))

# Manage group membership on a node in a scene
func manage_groups(params):
    log_info("Managing groups in scene: " + params.scene_path)

    var full_scene_path = ensure_res_prefix(params.scene_path)

    # Load the scene
    var scene = load(full_scene_path)
    if not scene:
        log_error("Failed to load scene: " + full_scene_path)
        quit(1)

    var scene_root = scene.instantiate()

    # Find target node
    var target = find_node_by_path(scene_root, params.node_path)
    if not target:
        log_error("Node not found: " + params.node_path)
        quit(1)

    # Add groups (persistent = true for pack/save survival)
    if params.has("add_groups"):
        for group_name in params.add_groups:
            target.add_to_group(group_name, true)

    # Remove groups (no error if not in group)
    if params.has("remove_groups"):
        for group_name in params.remove_groups:
            target.remove_from_group(group_name)

    # Pack and save
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if result != OK:
        log_error("Failed to pack scene after group management: " + str(result))
        quit(1)

    var save_error = ResourceSaver.save(packed_scene, full_scene_path)
    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        quit(1)

    print(JSON.stringify({
        "success": true,
        "node": params.node_path,
        "groups": target.get_groups()
    }))

# Add an input action to ProjectSettings with support for key, joypad button, and joypad motion events
func add_input_action(params):
    var action_name = params.get("action_name", "")
    if action_name == "":
        log_error("Missing required parameter: action_name")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: action_name"}))
        return

    var events_data = params.get("events", [])
    var deadzone = float(params.get("deadzone", 0.5))

    log_info("Adding input action: " + action_name)

    var events_array: Array[InputEvent] = []
    for event_data in events_data:
        var event_type = event_data.get("type", "")
        match event_type:
            "key":
                var key_event = InputEventKey.new()
                if event_data.has("key"):
                    key_event.physical_keycode = OS.find_keycode_from_string(event_data.key)
                elif event_data.has("physical_keycode"):
                    key_event.physical_keycode = int(event_data.physical_keycode)
                if event_data.has("keycode"):
                    key_event.keycode = int(event_data.keycode)
                events_array.append(key_event)
            "joypad_button":
                var btn_event = InputEventJoypadButton.new()
                btn_event.button_index = int(event_data.get("button_index", 0))
                events_array.append(btn_event)
            "joypad_motion":
                var motion_event = InputEventJoypadMotion.new()
                motion_event.axis = int(event_data.get("axis", 0))
                motion_event.axis_value = float(event_data.get("axis_value", 1.0))
                events_array.append(motion_event)
            _:
                log_error("Unknown event type: " + event_type)
                print(JSON.stringify({"success": false, "error": "Unknown event type: " + event_type}))
                return

    ProjectSettings.set_setting("input/" + action_name, {"deadzone": deadzone, "events": events_array})
    var save_err = ProjectSettings.save()
    if save_err != OK:
        log_error("Failed to save ProjectSettings: " + str(save_err))
        print(JSON.stringify({"success": false, "error": "Failed to save ProjectSettings: " + str(save_err)}))
        return

    print(JSON.stringify({"success": true, "action": action_name, "event_count": events_array.size()}))

# Remove an input action from ProjectSettings
func remove_input_action(params):
    var action_name = params.get("action_name", "")
    if action_name == "":
        log_error("Missing required parameter: action_name")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: action_name"}))
        return

    log_info("Removing input action: " + action_name)

    if not ProjectSettings.has_setting("input/" + action_name):
        log_error("Input action not found: " + action_name)
        print(JSON.stringify({"success": false, "error": "Input action not found: " + action_name}))
        return

    ProjectSettings.set_setting("input/" + action_name, null)
    var save_err = ProjectSettings.save()
    if save_err != OK:
        log_error("Failed to save ProjectSettings: " + str(save_err))
        print(JSON.stringify({"success": false, "error": "Failed to save ProjectSettings: " + str(save_err)}))
        return

    print(JSON.stringify({"success": true, "action": action_name}))

# Create a ShaderMaterial from a shader file with optional parameters
func create_shader_material(params):
    var shader_path = ensure_res_prefix(params.get("shader_path", ""))
    var output_path = ensure_res_prefix(params.get("output_path", ""))
    var shader_params = params.get("shader_params", {})
    var param_types = params.get("param_types", {})

    if shader_path == "res://" or output_path == "res://":
        log_error("Missing required parameters: shader_path and output_path")
        print(JSON.stringify({"success": false, "error": "Missing required parameters: shader_path and output_path"}))
        return

    log_info("Creating shader material from: " + shader_path + " to: " + output_path)

    var shader = load(shader_path) as Shader
    if shader == null:
        log_error("Failed to load shader: " + shader_path)
        print(JSON.stringify({"success": false, "error": "Failed to load shader: " + shader_path}))
        return

    var material = ShaderMaterial.new()
    material.shader = shader

    for param_name in shader_params:
        var type_hint = param_types.get(param_name, "")
        var value = convert_json_to_godot_type(shader_params[param_name], type_hint)
        material.set_shader_parameter(param_name, value)

    # Ensure output directory exists
    var dir_path = output_path.get_base_dir()
    if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(dir_path)):
        var dir = DirAccess.open("res://")
        if dir:
            var relative_dir = dir_path.substr(6)  # Remove "res://" prefix
            if not relative_dir.is_empty():
                dir.make_dir_recursive(relative_dir)

    var error = ResourceSaver.save(material, output_path)
    if error != OK:
        log_error("Failed to save shader material: " + str(error))
        print(JSON.stringify({"success": false, "error": "Failed to save shader material: " + str(error)}))
        return

    print(JSON.stringify({"success": true, "path": output_path}))

# Set shader parameters on an existing ShaderMaterial resource
func set_shader_params(params):
    var material_path = ensure_res_prefix(params.get("material_path", ""))
    var shader_params = params.get("shader_params", {})
    var param_types = params.get("param_types", {})

    if material_path == "res://":
        log_error("Missing required parameter: material_path")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: material_path"}))
        return

    log_info("Setting shader params on: " + material_path)

    var material = load(material_path) as ShaderMaterial
    if material == null:
        log_error("Failed to load ShaderMaterial: " + material_path)
        print(JSON.stringify({"success": false, "error": "Failed to load ShaderMaterial: " + material_path}))
        return

    var count = 0
    for param_name in shader_params:
        var type_hint = param_types.get(param_name, "")
        var value = convert_json_to_godot_type(shader_params[param_name], type_hint)
        material.set_shader_parameter(param_name, value)
        count += 1

    var error = ResourceSaver.save(material, material_path)
    if error != OK:
        log_error("Failed to save shader material: " + str(error))
        print(JSON.stringify({"success": false, "error": "Failed to save shader material: " + str(error)}))
        return

    print(JSON.stringify({"success": true, "path": material_path, "params_set": count}))

# Create an Animation resource with value tracks and keyframes
func create_animation(params):
    var output_path = ensure_res_prefix(params.get("output_path", ""))
    var length = float(params.get("length", 1.0))
    var loop_mode_str = params.get("loop_mode", "none")
    var step = float(params.get("step", 0.1))
    var tracks = params.get("tracks", [])

    if output_path == "res://":
        log_error("Missing required parameter: output_path")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: output_path"}))
        return

    log_info("Creating animation: " + output_path)

    var anim = Animation.new()
    anim.length = length
    anim.step = step

    # Map loop mode string to Animation constant
    match loop_mode_str:
        "linear":
            anim.loop_mode = Animation.LOOP_LINEAR
        "pingpong":
            anim.loop_mode = Animation.LOOP_PINGPONG
        _:
            anim.loop_mode = Animation.LOOP_NONE

    # Add tracks and keyframes
    for track in tracks:
        var track_idx = anim.add_track(Animation.TYPE_VALUE)
        anim.track_set_path(track_idx, track.get("path", ""))

        var keyframes = track.get("keyframes", [])
        for kf in keyframes:
            var time = float(kf.get("time", 0.0))
            var type_hint = kf.get("type", "")
            var value = convert_json_to_godot_type(kf.get("value"), type_hint)
            anim.track_insert_key(track_idx, time, value)

    # Ensure output directory exists
    var dir_path = output_path.get_base_dir()
    if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(dir_path)):
        var dir = DirAccess.open("res://")
        if dir:
            var relative_dir = dir_path.substr(6)  # Remove "res://" prefix
            if not relative_dir.is_empty():
                dir.make_dir_recursive(relative_dir)

    var error = ResourceSaver.save(anim, output_path)
    if error != OK:
        log_error("Failed to save animation: " + str(error))
        print(JSON.stringify({"success": false, "error": "Failed to save animation: " + str(error)}))
        return

    print(JSON.stringify({"success": true, "path": output_path, "track_count": anim.get_track_count()}))

# Create an AnimationLibrary containing named animations
func create_animation_library(params):
    var output_path = ensure_res_prefix(params.get("output_path", ""))
    var animations = params.get("animations", {})

    if output_path == "res://":
        log_error("Missing required parameter: output_path")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: output_path"}))
        return

    log_info("Creating animation library: " + output_path)

    var library = AnimationLibrary.new()
    var count = 0

    for anim_name in animations:
        var anim_path = ensure_res_prefix(animations[anim_name])
        var anim = load(anim_path) as Animation
        if anim == null:
            log_error("Failed to load animation: " + anim_path)
            print(JSON.stringify({"success": false, "error": "Failed to load animation: " + anim_path}))
            return
        library.add_animation(anim_name, anim)
        count += 1

    # Ensure output directory exists
    var dir_path = output_path.get_base_dir()
    if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(dir_path)):
        var dir = DirAccess.open("res://")
        if dir:
            var relative_dir = dir_path.substr(6)  # Remove "res://" prefix
            if not relative_dir.is_empty():
                dir.make_dir_recursive(relative_dir)

    var error = ResourceSaver.save(library, output_path)
    if error != OK:
        log_error("Failed to save animation library: " + str(error))
        print(JSON.stringify({"success": false, "error": "Failed to save animation library: " + str(error)}))
        return

    print(JSON.stringify({"success": true, "path": output_path, "animation_count": count}))

# Add keyframes to an existing animation track
func add_keyframes(params):
    var animation_path = ensure_res_prefix(params.get("animation_path", ""))
    var track_index = params.get("track_index", -1)
    var track_path = params.get("track_path", "")
    var keyframes = params.get("keyframes", [])

    if animation_path == "res://":
        log_error("Missing required parameter: animation_path")
        print(JSON.stringify({"success": false, "error": "Missing required parameter: animation_path"}))
        return

    log_info("Adding keyframes to animation: " + animation_path)

    var anim = load(animation_path) as Animation
    if anim == null:
        log_error("Failed to load animation: " + animation_path)
        print(JSON.stringify({"success": false, "error": "Failed to load animation: " + animation_path}))
        return

    # Resolve track index
    var resolved_idx = int(track_index)
    if resolved_idx < 0 and track_path != "":
        # Search for track by path
        for i in range(anim.get_track_count()):
            if str(anim.track_get_path(i)) == track_path:
                resolved_idx = i
                break

    if resolved_idx < 0 or resolved_idx >= anim.get_track_count():
        log_error("Track not found. Index: " + str(track_index) + ", Path: " + track_path)
        print(JSON.stringify({"success": false, "error": "Track not found. Index: " + str(track_index) + ", Path: " + track_path}))
        return

    # Insert keyframes
    var count = 0
    for kf in keyframes:
        var time = float(kf.get("time", 0.0))
        var type_hint = kf.get("type", "")
        var value = convert_json_to_godot_type(kf.get("value"), type_hint)
        anim.track_insert_key(resolved_idx, time, value)
        count += 1

    var error = ResourceSaver.save(anim, animation_path)
    if error != OK:
        log_error("Failed to save animation: " + str(error))
        print(JSON.stringify({"success": false, "error": "Failed to save animation: " + str(error)}))
        return

    print(JSON.stringify({"success": true, "path": animation_path, "keyframes_added": count}))

# Assign an AnimationLibrary to an AnimationPlayer node in a scene
func assign_animation_library(params):
    var scene_path = ensure_res_prefix(params.get("scene_path", ""))
    var node_path = params.get("node_path", "")
    var library_name = params.get("library_name", "")
    var library_path = ensure_res_prefix(params.get("library_path", ""))

    if scene_path == "res://" or library_path == "res://":
        log_error("Missing required parameters: scene_path and library_path")
        print(JSON.stringify({"success": false, "error": "Missing required parameters: scene_path and library_path"}))
        return

    log_info("Assigning animation library to scene: " + scene_path)

    # Load the scene
    var scene = load(scene_path)
    if not scene:
        log_error("Failed to load scene: " + scene_path)
        print(JSON.stringify({"success": false, "error": "Failed to load scene: " + scene_path}))
        return

    var scene_root = scene.instantiate()

    # Find the AnimationPlayer node
    var target = find_node_by_path(scene_root, node_path)
    if not target:
        log_error("Node not found: " + node_path)
        print(JSON.stringify({"success": false, "error": "Node not found: " + node_path}))
        return

    if not target is AnimationPlayer:
        log_error("Target node is not an AnimationPlayer: " + node_path)
        print(JSON.stringify({"success": false, "error": "Target node is not an AnimationPlayer: " + node_path}))
        return

    # Load the animation library
    var library = load(library_path) as AnimationLibrary
    if library == null:
        log_error("Failed to load animation library: " + library_path)
        print(JSON.stringify({"success": false, "error": "Failed to load animation library: " + library_path}))
        return

    # Add the library to the AnimationPlayer
    target.add_animation_library(library_name, library)

    # Pack and save scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(scene_root)
    if result != OK:
        log_error("Failed to pack scene after assigning animation library: " + str(result))
        print(JSON.stringify({"success": false, "error": "Failed to pack scene: " + str(result)}))
        return

    var save_error = ResourceSaver.save(packed_scene, scene_path)
    if save_error != OK:
        log_error("Failed to save scene: " + str(save_error))
        print(JSON.stringify({"success": false, "error": "Failed to save scene: " + str(save_error)}))
        return

    print(JSON.stringify({"success": true, "library_name": library_name, "scene_path": scene_path}))
