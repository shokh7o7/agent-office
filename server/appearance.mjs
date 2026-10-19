// Agent looks are owned by the server so the web office and the PC app always
// draw the same character. The generator is a byte-for-byte port of
// src/sim/seed.ts appearanceFor(), so agents keep the look they already had.
export const SKINS = ['#f2c9a0', '#e0ac7e', '#c68a5b', '#8d5a3a', '#5c3a26', '#f7d9bd'];
export const HAIRS = ['#2b1d16', '#5a3520', '#a8662c', '#d9b25f', '#e6e1d8', '#7a2e2e', '#2f3a55', '#151515'];
export const SHIRTS = ['#e8eef2', '#c4473a', '#e07b2e', '#3d6aa8', '#4f8a4b', '#7b4f9c', '#2f3b52', '#d9b84a', '#4aa3a0'];
export const PANTS = ['#2a3247', '#3b3b44', '#5a4632', '#1f2a2e', '#46506a'];
export const HAIR_STYLES = ['short', 'long', 'spiky', 'bun', 'curly', 'bald'];

/** FNV-1a, identical to src/sim/random.ts hash(). */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function appearanceFor(key) {
  const h = hash(key);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 3) % HAIRS.length],
    hairStyle: HAIR_STYLES[(h >>> 7) % HAIR_STYLES.length],
    shirt: SHIRTS[(h >>> 11) % SHIRTS.length],
    pants: PANTS[(h >>> 15) % PANTS.length],
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Accept a client-supplied appearance only if every field is valid. */
export function sanitizeAppearance(a) {
  if (!a || typeof a !== 'object') return null;
  const ok = HEX.test(a.skin) && HEX.test(a.hair) && HEX.test(a.shirt) && HEX.test(a.pants) && HAIR_STYLES.includes(a.hairStyle);
  return ok ? { skin: a.skin, hair: a.hair, hairStyle: a.hairStyle, shirt: a.shirt, pants: a.pants } : null;
}

/** Looks for the four built-in agents that match their names. */
export const DEFAULT_LOOKS = {
  'gm-dilnoza': { skin: SKINS[0], hair: HAIRS[1], hairStyle: 'long', shirt: SHIRTS[5], pants: PANTS[0] },
  'gm-jasur': { skin: SKINS[1], hair: HAIRS[7], hairStyle: 'short', shirt: SHIRTS[3], pants: PANTS[1] },
  'gm-malika': { skin: SKINS[5], hair: HAIRS[0], hairStyle: 'bun', shirt: SHIRTS[1], pants: PANTS[4] },
  'gm-sardor': { skin: SKINS[2], hair: HAIRS[0], hairStyle: 'spiky', shirt: SHIRTS[4], pants: PANTS[3] },
};
