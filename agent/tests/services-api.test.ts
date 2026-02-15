import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveConfig, findConfigPath } from '../server/config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-svc-api-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeHubConfig(dir: string, services: string[]): void {
  const svcYaml = services.map(s => `  - name: ${s}`).join('\n');
  const content = `version: "0.1"
project:
  name: test-hub
repo_model: multi-repo
role: orchestrator
services:
${svcYaml}
`;
  fs.writeFileSync(path.join(dir, 'config.yaml'), content, 'utf-8');
}

function scaffoldHub(dir: string, services: string[]): void {
  writeHubConfig(dir, services);
  // Create basic hub structure
  for (const svc of services) {
    fs.mkdirSync(path.join(dir, 'comms', 'inbox', svc), { recursive: true });
    fs.writeFileSync(path.join(dir, 'comms', 'inbox', svc, '.gitkeep'), '', 'utf-8');
  }
  fs.mkdirSync(path.join(dir, 'registry'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'contracts'), { recursive: true });
}

describe('findConfigPath', () => {
  it('finds config.yaml in root (hub)', () => {
    writeHubConfig(tmpDir, ['svc-a']);
    const result = findConfigPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, 'config.yaml'));
  });

  it('finds config.yaml in .accord/', () => {
    const accordDir = path.join(tmpDir, '.accord');
    fs.mkdirSync(accordDir, { recursive: true });
    fs.writeFileSync(path.join(accordDir, 'config.yaml'), `
version: "0.1"
project:
  name: test
services:
  - name: svc
`, 'utf-8');
    const result = findConfigPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, '.accord', 'config.yaml'));
  });

  it('throws if no config found', () => {
    expect(() => findConfigPath(tmpDir)).toThrow('No config.yaml found');
  });
});

describe('saveConfig', () => {
  it('persists config to disk', () => {
    writeHubConfig(tmpDir, ['svc-a']);
    const config = loadConfig(tmpDir);
    config.services.push({ name: 'svc-b' });
    saveConfig(tmpDir, config);

    const reloaded = loadConfig(tmpDir);
    expect(reloaded.services).toHaveLength(2);
    expect(reloaded.services[1].name).toBe('svc-b');
  });

  it('preserves service fields like language and repo', () => {
    writeHubConfig(tmpDir, ['svc-a']);
    const config = loadConfig(tmpDir);
    config.services.push({ name: 'svc-b', language: 'typescript', repo: 'https://example.com/repo' });
    saveConfig(tmpDir, config);

    const reloaded = loadConfig(tmpDir);
    const svcB = reloaded.services.find(s => s.name === 'svc-b');
    expect(svcB).toBeDefined();
    expect(svcB!.language).toBe('typescript');
    expect(svcB!.repo).toBe('https://example.com/repo');
  });

  it('omits runtime fields (team, teamDir)', () => {
    writeHubConfig(tmpDir, ['svc-a']);
    const config = loadConfig(tmpDir);
    (config as any).team = 'runtime-team';
    (config as any).teamDir = '/tmp/runtime';
    saveConfig(tmpDir, config);

    const raw = fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf-8');
    expect(raw).not.toContain('runtime-team');
    expect(raw).not.toContain('/tmp/runtime');
  });
});

describe('service add/remove (config-level)', () => {
  it('adds a service to config', () => {
    scaffoldHub(tmpDir, ['frontend', 'backend']);
    const config = loadConfig(tmpDir);
    expect(config.services).toHaveLength(2);

    config.services.push({ name: 'payments', language: 'typescript' });
    saveConfig(tmpDir, config);

    const reloaded = loadConfig(tmpDir);
    expect(reloaded.services).toHaveLength(3);
    expect(reloaded.services.map(s => s.name)).toContain('payments');
  });

  it('removes a service from config', () => {
    scaffoldHub(tmpDir, ['frontend', 'backend']);
    const config = loadConfig(tmpDir);

    const idx = config.services.findIndex(s => s.name === 'backend');
    config.services.splice(idx, 1);
    saveConfig(tmpDir, config);

    const reloaded = loadConfig(tmpDir);
    expect(reloaded.services).toHaveLength(1);
    expect(reloaded.services[0].name).toBe('frontend');
  });

  it('scaffolds inbox directory for new service', () => {
    scaffoldHub(tmpDir, ['frontend']);
    const inboxDir = path.join(tmpDir, 'comms', 'inbox', 'payments');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, '.gitkeep'), '', 'utf-8');

    expect(fs.existsSync(inboxDir)).toBe(true);
    expect(fs.existsSync(path.join(inboxDir, '.gitkeep'))).toBe(true);
  });

  it('moves inbox to archive on remove', () => {
    scaffoldHub(tmpDir, ['frontend', 'backend']);
    // Add a request file to backend inbox
    const inboxDir = path.join(tmpDir, 'comms', 'inbox', 'backend');
    fs.writeFileSync(path.join(inboxDir, 'req-001.md'), 'test request', 'utf-8');

    // Move inbox to archive
    const archiveDir = path.join(tmpDir, 'comms', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const archiveDest = path.join(archiveDir, 'backend-archived');
    fs.renameSync(inboxDir, archiveDest);

    expect(fs.existsSync(inboxDir)).toBe(false);
    expect(fs.existsSync(archiveDest)).toBe(true);
    expect(fs.existsSync(path.join(archiveDest, 'req-001.md'))).toBe(true);
  });
});

describe('service name validation', () => {
  const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

  it('accepts valid names', () => {
    expect(NAME_RE.test('my-service')).toBe(true);
    expect(NAME_RE.test('svc-123')).toBe(true);
    expect(NAME_RE.test('a')).toBe(true);
    expect(NAME_RE.test('frontend')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(NAME_RE.test('')).toBe(false);
    expect(NAME_RE.test('-starts-with-dash')).toBe(false);
    expect(NAME_RE.test('Has-Uppercase')).toBe(false);
    expect(NAME_RE.test('has spaces')).toBe(false);
    expect(NAME_RE.test('has_underscores')).toBe(false);
    expect(NAME_RE.test('special!chars')).toBe(false);
  });
});

describe('duplicate detection', () => {
  it('detects duplicate service names', () => {
    scaffoldHub(tmpDir, ['frontend', 'backend']);
    const config = loadConfig(tmpDir);
    const isDuplicate = config.services.some(s => s.name === 'frontend');
    expect(isDuplicate).toBe(true);
  });

  it('allows non-duplicate service names', () => {
    scaffoldHub(tmpDir, ['frontend', 'backend']);
    const config = loadConfig(tmpDir);
    const isDuplicate = config.services.some(s => s.name === 'payments');
    expect(isDuplicate).toBe(false);
  });
});
