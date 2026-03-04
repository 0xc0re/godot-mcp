/**
 * Type definitions for parsed Godot project.godot settings.
 *
 * The project.godot file uses an INI-like format with sections
 * (e.g. [application], [autoload]) and key=value pairs.
 */

export interface ParsedProjectSettings {
  /** Section name -> key -> raw string value */
  sections: Record<string, Record<string, string>>;
  /** Top-level config_version value (e.g. 5 for Godot 4.x) */
  configVersion: number;
}
