import type { AgentRole, Appearance, HairStyle } from '../types';
import type { NewAgentInput } from './engine';
import { hash } from './random';

export const SKINS = ['#f2c9a0', '#e0ac7e', '#c68a5b', '#8d5a3a', '#5c3a26', '#f7d9bd'];
export const HAIRS = ['#2b1d16', '#5a3520', '#a8662c', '#d9b25f', '#e6e1d8', '#7a2e2e', '#2f3a55', '#151515'];
export const SHIRTS = ['#e8eef2', '#c4473a', '#e07b2e', '#3d6aa8', '#4f8a4b', '#7b4f9c', '#2f3b52', '#d9b84a', '#4aa3a0'];
export const PANTS = ['#2a3247', '#3b3b44', '#5a4632', '#1f2a2e', '#46506a'];
export const HAIR_STYLES: HairStyle[] = ['short', 'long', 'spiky', 'bun', 'curly', 'bald'];
export const ROLES: AgentRole[] = ['Developer', 'Researcher', 'Designer', 'Writer', 'Tester', 'Analyst', 'Manager'];

export function appearanceFor(key: string): Appearance {
  const h = hash(key);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 3) % HAIRS.length],
    hairStyle: HAIR_STYLES[(h >>> 7) % HAIR_STYLES.length],
    shirt: SHIRTS[(h >>> 11) % SHIRTS.length],
    pants: PANTS[(h >>> 15) % PANTS.length],
  };
}

const a = (skin: number, hair: number, hairStyle: HairStyle, shirt: number, pants: number): Appearance => ({
  skin: SKINS[skin],
  hair: HAIRS[hair],
  hairStyle,
  shirt: SHIRTS[shirt],
  pants: PANTS[pants],
});

export const SEED_AGENTS: NewAgentInput[] = [
  { name: 'Mira', role: 'Developer', appearance: a(0, 1, 'spiky', 0, 0), provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { name: 'Theo', role: 'Researcher', appearance: a(3, 7, 'curly', 2, 1), provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { name: 'Iris', role: 'Designer', appearance: a(1, 4, 'long', 0, 2) },
  { name: 'Kenji', role: 'Tester', appearance: a(0, 7, 'short', 1, 0) },
  { name: 'Lena', role: 'Writer', appearance: a(5, 3, 'long', 6, 3), provider: 'anthropic', model: 'claude-haiku-4-5' },
  { name: 'Omar', role: 'Analyst', appearance: a(2, 0, 'short', 3, 4) },
  { name: 'Sofia', role: 'Developer', appearance: a(1, 5, 'bun', 4, 0) },
  { name: 'Ravi', role: 'Analyst', appearance: a(3, 0, 'spiky', 7, 1) },
  { name: 'June', role: 'Designer', appearance: a(0, 2, 'curly', 5, 2) },
  { name: 'Ada', role: 'Manager', appearance: a(4, 6, 'bun', 6, 0), deskId: 'ws-A13' },
];

export const SEED_TASKS: { title: string; description: string; agent: string }[] = [
  { title: 'Refactor the login form', description: 'Split validation from rendering and add unit tests.', agent: 'Mira' },
  { title: 'Summarise competitor pricing pages', description: 'Five competitors, one paragraph each.', agent: 'Theo' },
  { title: 'Draft onboarding email series', description: 'Three short emails for new users.', agent: 'Lena' },
  { title: 'Regression pass [fail]', description: 'Demo task that fails on the first attempt so you can try Retry.', agent: 'Kenji' },
];
