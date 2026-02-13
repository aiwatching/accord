import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, getDispatcherConfig, getServiceNames, getServiceDir, getAccordDir } from '../server/config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(dir: string, content: string, inAccord = true): void {
  const configDir = inAccord ? path.join(dir, '.accord') : dir;
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.yaml'), content, 'utf-8');
}

describe('loadConfig', () => {
  it('loads config from .accord/config.yaml', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test-project
repo_model: monorepo
services:
  - name: svc-a
  - name: svc-b
`);
    const config = loadConfig(tmpDir);
    expect(config.project.name).toBe('test-project');
    expect(config.repo_model).toBe('monorepo');
    expect(config.services).toHaveLength(2);
    expect(config.services[0].name).toBe('svc-a');
  });

  it('loads config from root config.yaml (hub)', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: hub-project
repo_model: multi-repo
role: orchestrator
services:
  - name: svc-a
`, false);
    const config = loadConfig(tmpDir);
    expect(config.project.name).toBe('hub-project');
    expect(config.role).toBe('orchestrator');
  });

  it('throws if no config found', () => {
    expect(() => loadConfig(tmpDir)).toThrow('No config.yaml found');
  });

  it('throws if project name is missing', () => {
    writeConfig(tmpDir, `
version: "0.1"
services:
  - name: svc-a
`);
    expect(() => loadConfig(tmpDir)).toThrow('project.name is required');
  });

  it('throws if services array is empty', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
services: []
`);
    expect(() => loadConfig(tmpDir)).toThrow('services array is required');
  });
});

describe('getDispatcherConfig', () => {
  it('returns defaults when no dispatcher section', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: monorepo
services:
  - name: svc
`);
    const config = loadConfig(tmpDir);
    const dc = getDispatcherConfig(config);
    expect(dc.workers).toBe(4);
    expect(dc.poll_interval).toBe(30);
    expect(dc.session_max_requests).toBe(15);
    expect(dc.max_attempts).toBe(3);
    expect(dc.debug).toBe(false);
  });

  it('merges user overrides', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: monorepo
services:
  - name: svc
dispatcher:
  workers: 8
  poll_interval: 10
`);
    const config = loadConfig(tmpDir);
    const dc = getDispatcherConfig(config);
    expect(dc.workers).toBe(8);
    expect(dc.poll_interval).toBe(10);
    expect(dc.session_max_requests).toBe(15); // still default
  });

  it('inherits debug from settings', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: monorepo
services:
  - name: svc
settings:
  debug: true
`);
    const config = loadConfig(tmpDir);
    const dc = getDispatcherConfig(config);
    expect(dc.debug).toBe(true);
  });
});

describe('getServiceNames', () => {
  it('returns all service names', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: monorepo
services:
  - name: alpha
  - name: beta
  - name: gamma
`);
    const config = loadConfig(tmpDir);
    expect(getServiceNames(config)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('getServiceDir', () => {
  it('returns same dir for monorepo', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: monorepo
services:
  - name: svc
`);
    const config = loadConfig(tmpDir);
    expect(getServiceDir(config, 'svc', tmpDir)).toBe(tmpDir);
  });

  it('returns sibling dir for multi-repo', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: multi-repo
services:
  - name: my-service
`);
    const config = loadConfig(tmpDir);
    const result = getServiceDir(config, 'my-service', tmpDir);
    expect(result).toBe(path.resolve(tmpDir, '..', 'my-service'));
  });

  it('uses configured directory if set', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: multi-repo
services:
  - name: my-service
    directory: /custom/path
`);
    const config = loadConfig(tmpDir);
    const result = getServiceDir(config, 'my-service', tmpDir);
    expect(result).toBe('/custom/path');
  });
});

describe('getAccordDir', () => {
  it('returns .accord for non-orchestrator', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: monorepo
services:
  - name: svc
`);
    const config = loadConfig(tmpDir);
    expect(getAccordDir(tmpDir, config)).toBe(path.join(tmpDir, '.accord'));
  });

  it('returns root for orchestrator', () => {
    writeConfig(tmpDir, `
version: "0.1"
project:
  name: test
repo_model: multi-repo
role: orchestrator
services:
  - name: svc
`, false);
    const config = loadConfig(tmpDir);
    expect(getAccordDir(tmpDir, config)).toBe(tmpDir);
  });
});
