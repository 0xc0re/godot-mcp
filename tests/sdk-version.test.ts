import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

describe('SDK version', () => {
  it('has @modelcontextprotocol/sdk >= 1.27.0', () => {
    const sdkVersion = packageJson.dependencies['@modelcontextprotocol/sdk'];
    expect(sdkVersion).toBeDefined();
    // Strip ^ or ~ prefix to get the base version
    const baseVersion = sdkVersion.replace(/^[\^~]/, '');
    const [major, minor] = baseVersion.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(1);
    if (major === 1) {
      expect(minor).toBeGreaterThanOrEqual(27);
    }
  });
});

describe('Zod dependency', () => {
  it('has zod as a direct dependency >= 3.25.0', () => {
    const zodVersion = packageJson.dependencies['zod'];
    expect(zodVersion).toBeDefined();
    const baseVersion = zodVersion.replace(/^[\^~]/, '');
    const [major, minor] = baseVersion.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(3);
    if (major === 3) {
      expect(minor).toBeGreaterThanOrEqual(25);
    }
  });
});

describe('Removed dependencies', () => {
  it('does not have axios in dependencies', () => {
    expect(packageJson.dependencies['axios']).toBeUndefined();
  });
});
