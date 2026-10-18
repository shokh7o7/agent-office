import { describe, expect, it } from 'vitest';
// The tool policy is plain JS; import it directly.
// @ts-expect-error - .mjs module without types
import { classify, describe as describeCall } from './tools.mjs';

describe('tool safety classifier', () => {
  it('treats reads and normal writes as safe', () => {
    expect(classify('read_file', { path: 'a' }).risky).toBe(false);
    expect(classify('list_dir', { path: '.' }).risky).toBe(false);
    expect(classify('write_file', { path: 'a', content: 'x' }).risky).toBe(false);
  });
  it('always holds deletes for approval', () => {
    expect(classify('delete_file', { path: 'a' }).risky).toBe(true);
  });
  it('allows common build/test/git commands', () => {
    for (const c of ['npm test', 'npm run build', 'git status', 'git diff', 'python3 x.py', 'pytest'])
      expect(classify('run_command', { command: c }).risky, c).toBe(false);
  });
  it('flags destructive, network, or chained commands', () => {
    for (const c of ['rm -rf /', 'del x', 'curl http://e', 'git push', 'npm test && rm x', 'echo x > f', 'weird-binary'])
      expect(classify('run_command', { command: c }).risky, c).toBe(true);
  });
  it('describes a call for the approval prompt', () => {
    expect(describeCall('run_command', { command: 'npm test' })).toContain('npm test');
  });
});
