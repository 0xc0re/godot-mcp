/**
 * Registry smoke test: registers all 16 tool modules against a real McpServer
 * and asserts the complete expected tool roster (68 tools) is present, with
 * no duplicates and no strays.
 *
 * No mocks — registration only wires up handlers; nothing touches the
 * filesystem or spawns Godot until a handler is invoked.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/types.js';

import { registerEditorTools } from '../src/tools/editor.js';
import { registerProjectTools } from '../src/tools/project.js';
import { registerResourceTools } from '../src/tools/resource.js';
import { registerSceneTools } from '../src/tools/scene.js';
import { registerScriptTools } from '../src/tools/script.js';
import { registerUidTools } from '../src/tools/uid.js';
import { registerDiagnosticsTools } from '../src/tools/diagnostics.js';
import { registerCompositionTools } from '../src/tools/composition.js';
import { registerConfigTools } from '../src/tools/config.js';
import { registerShaderTools } from '../src/tools/shader.js';
import { registerExportTools } from '../src/tools/export.js';
import { registerAnimationTools } from '../src/tools/animation.js';
import { registerTileMapTools } from '../src/tools/tilemap.js';
import { registerRuntimeTools } from '../src/tools/runtime.js';
import { registerTestingTools } from '../src/tools/testing.js';
import { registerScaffoldTools } from '../src/tools/scaffold.js';

/**
 * The authoritative tool roster, grouped by module. Derived from the
 * server.registerTool calls in each src/tools/*.ts file (68 total).
 * A tool added or removed in src/ without updating this list fails the test.
 */
const EXPECTED_TOOLS: Record<string, string[]> = {
  editor: [
    'launch_editor',
    'run_project',
    'get_debug_output',
    'stop_project',
    'capture_screenshot',
  ],
  project: [
    'get_godot_version',
    'list_projects',
    'get_project_info',
    'read_project_settings',
    'modify_project_setting',
  ],
  resource: ['read_resource', 'create_resource', 'modify_resource'],
  scene: [
    'create_scene',
    'add_node',
    'load_sprite',
    'export_mesh_library',
    'save_scene',
    'read_scene',
    'modify_node_property',
    'remove_node',
    'attach_script',
  ],
  script: ['validate_scripts', 'list_scripts', 'query_class'],
  uid: ['get_uid', 'update_project_uids'],
  diagnostics: ['get_diagnostics', 'validate_scene'],
  composition: [
    'connect_signal',
    'disconnect_signal',
    'instance_scene',
    'manage_groups',
    'inspect_group',
  ],
  config: [
    'add_input_action',
    'remove_input_action',
    'list_input_actions',
    'get_collision_layer_names',
    'set_collision_layer_names',
    'set_node_collision',
    'list_autoloads',
    'add_autoload',
    'remove_autoload',
  ],
  shader: ['create_shader', 'create_shader_material', 'set_shader_params'],
  export: ['list_export_presets', 'export_project', 'check_export_readiness'],
  animation: [
    'create_animation',
    'add_keyframes',
    'create_animation_library',
    'assign_animation_library',
  ],
  tilemap: ['create_tileset', 'paint_tilemap'],
  runtime: [
    'inspect_scene_tree',
    'inspect_node',
    'restart_project',
    'batch_set_properties',
    'send_input',
    'invoke_runtime',
    'wait_for',
  ],
  testing: ['run_tests'],
  scaffold: [
    'scaffold_event_bus',
    'scaffold_health_component',
    'scaffold_config_manager',
    'scaffold_resource_class',
    'scaffold_tests',
  ],
};

const ALL_EXPECTED = Object.values(EXPECTED_TOOLS).flat();

function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/path/to/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
  };
}

/** Register every tool module and capture the registered tool names. */
function registerAllTools(): { server: McpServer; registered: string[] } {
  const server = new McpServer(
    { name: 'test', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );
  const registered: string[] = [];
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = function (name: string, config: unknown, handler: unknown) {
    registered.push(name);
    return originalRegisterTool(
      name,
      config as Parameters<typeof originalRegisterTool>[1],
      handler as Parameters<typeof originalRegisterTool>[2],
    );
  } as typeof server.registerTool;

  const ctx = createTestContext();
  registerEditorTools(server, ctx);
  registerProjectTools(server, ctx);
  registerResourceTools(server, ctx);
  registerSceneTools(server, ctx);
  registerScriptTools(server, ctx);
  registerUidTools(server, ctx);
  registerDiagnosticsTools(server, ctx);
  registerCompositionTools(server, ctx);
  registerConfigTools(server, ctx);
  registerShaderTools(server, ctx);
  registerExportTools(server, ctx);
  registerAnimationTools(server, ctx);
  registerTileMapTools(server, ctx);
  registerRuntimeTools(server, ctx);
  registerTestingTools(server, ctx);
  registerScaffoldTools(server, ctx);

  return { server, registered };
}

describe('Tool registry smoke test', () => {
  it('registers all 16 modules against a real McpServer without throwing', () => {
    expect(() => registerAllTools()).not.toThrow();
  });

  it('registers exactly the expected 68 tools', () => {
    const { registered } = registerAllTools();

    // Exact set equality, reported symmetrically so a failure names the tool
    const missing = ALL_EXPECTED.filter((name) => !registered.includes(name));
    const unexpected = registered.filter((name) => !ALL_EXPECTED.includes(name));
    expect(missing).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(registered).toHaveLength(68);
  });

  it('registers no duplicate tool names', () => {
    const { registered } = registerAllTools();
    const duplicates = registered.filter((name, i) => registered.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });

  it.each(Object.entries(EXPECTED_TOOLS))(
    'module %s contributes its expected tools',
    (_module, tools) => {
      const { registered } = registerAllTools();
      for (const tool of tools) {
        expect(registered).toContain(tool);
      }
    },
  );
});
