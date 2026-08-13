import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make the build/index.js file executable
fs.chmodSync(path.join(__dirname, '..', 'build', 'index.js'), '755');

// Copy the entire src/scripts directory to build/scripts so every .gd helper
// (godot_operations.gd, runtime_helper.gd, screenshot_helper.gd,
// resize_image.gd, and any future additions) ships in installed packages.
try {
  const srcScripts = path.join(__dirname, '..', 'src', 'scripts');
  const buildScripts = path.join(__dirname, '..', 'build', 'scripts');

  fs.copySync(srcScripts, buildScripts);

  const copied = fs.readdirSync(buildScripts).sort();
  console.log(`Successfully copied src/scripts to build/scripts: ${copied.join(', ')}`);
} catch (error) {
  console.error('Error copying scripts:', error);
  process.exit(1);
}

console.log('Build scripts completed successfully!');
