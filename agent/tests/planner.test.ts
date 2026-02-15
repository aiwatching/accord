import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildPlannerPrompt } from '../server/planner.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accord-planner-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildPlannerPrompt', () => {
  it('includes all service names', () => {
    const prompt = buildPlannerPrompt('add login page', ['auth-svc', 'web-ui', 'db-svc'], tmpDir);

    expect(prompt).toContain('- auth-svc');
    expect(prompt).toContain('- web-ui');
    expect(prompt).toContain('- db-svc');
  });

  it('includes the user message', () => {
    const prompt = buildPlannerPrompt('implement device list feature', ['svc-a'], tmpDir);

    expect(prompt).toContain('implement device list feature');
  });

  it('contains role and output format instructions', () => {
    const prompt = buildPlannerPrompt('some task', ['svc-a'], tmpDir);

    expect(prompt).toContain('Execution Planner');
    expect(prompt).toContain('### Execution Plan');
    expect(prompt).toContain('### Dependencies');
    expect(prompt).toContain('### Expected Outcome');
  });

  it('includes registry info when registry files exist', () => {
    const registryDir = path.join(tmpDir, 'registry');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, 'auth-svc.yaml'),
      'name: auth-svc\ndescription: Authentication service\nmaintainer: ai\n',
    );

    const prompt = buildPlannerPrompt('add login', ['auth-svc', 'web-ui'], tmpDir);

    expect(prompt).toContain('Service Registry Info');
    expect(prompt).toContain('### auth-svc');
    expect(prompt).toContain('Authentication service');
  });

  it('handles missing registry directory gracefully', () => {
    const prompt = buildPlannerPrompt('task', ['svc-a'], tmpDir);

    expect(prompt).not.toContain('Service Registry Info');
    expect(prompt).toContain('- svc-a');
  });

  it('tries .md fallback when .yaml not present', () => {
    const registryDir = path.join(tmpDir, 'registry');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, 'svc-b.md'),
      '---\nname: svc-b\nmaintainer: human\n---\nService B handles payments.\n',
    );

    const prompt = buildPlannerPrompt('process payments', ['svc-b'], tmpDir);

    expect(prompt).toContain('### svc-b');
    expect(prompt).toContain('name: svc-b');
  });

  it('does not instruct the planner to execute anything', () => {
    const prompt = buildPlannerPrompt('deploy feature', ['svc-a'], tmpDir);

    expect(prompt).toContain('Do NOT execute anything');
    expect(prompt).toContain('only produce a plan');
  });
});
