import { describe, expect, it } from 'vitest';
import { appearanceFor as clientLook } from '../src/sim/seed';
// @ts-expect-error - .mjs module without types
import { appearanceFor as serverLook, sanitizeAppearance, DEFAULT_LOOKS } from './appearance.mjs';
// @ts-expect-error - .mjs module without types
import { declarationsFor, ALL_TOOLS, BASE_TOOLS } from './runner/tools.mjs';

describe('server appearance', () => {
  it('matches the web app generator exactly, so existing agents keep their look', () => {
    for (const key of ['gm-jasur', 'gm-abc12345', 'agent_x', 'Ω', '', 'a'.repeat(50)]) expect(serverLook(key)).toEqual(clientLook(key));
  });
  it('rejects malformed looks', () => {
    expect(sanitizeAppearance({ skin: 'red', hair: '#000000', hairStyle: 'long', shirt: '#000000', pants: '#000000' })).toBeNull();
    expect(sanitizeAppearance({ skin: '#000000', hair: '#000000', hairStyle: 'mohawk', shirt: '#000000', pants: '#000000' })).toBeNull();
    expect(sanitizeAppearance(DEFAULT_LOOKS['gm-malika'])).toEqual(DEFAULT_LOOKS['gm-malika']);
  });
  it('gives the built-in women agents feminine hairstyles', () => {
    expect(['long', 'bun']).toContain(DEFAULT_LOOKS['gm-dilnoza'].hairStyle);
    expect(['long', 'bun']).toContain(DEFAULT_LOOKS['gm-malika'].hairStyle);
  });
});

describe('tool capabilities', () => {
  it('offers only the base set to runners that report nothing', () => {
    expect(declarationsFor().map((d: { name: string }) => d.name)).toEqual(BASE_TOOLS);
  });
  it('offers everything (one read_file) to a full runner', () => {
    const names = declarationsFor(ALL_TOOLS).map((d: { name: string }) => d.name);
    expect(names.filter((n: string) => n === 'read_file')).toHaveLength(1);
    expect(names).toEqual(expect.arrayContaining(['list_tree', 'search_files', 'edit_file']));
  });
});
