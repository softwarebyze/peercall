const ADJECTIVES = [
  'amber', 'brave', 'calm', 'crisp', 'dusk', 'ember', 'fable', 'flint',
  'gentle', 'harbor', 'ivory', 'jade', 'keen', 'lunar', 'maple', 'noble',
  'olive', 'plaid', 'quiet', 'rapid', 'silver', 'tidal', 'umbra', 'vivid',
  'willow', 'xenon', 'young', 'zephyr', 'coral', 'delta', 'frost', 'grove',
] as const

const NOUNS = [
  'otter', 'pine', 'river', 'sparrow', 'cedar', 'falcon', 'mesa', 'orchid',
  'pebble', 'quartz', 'raven', 'sage', 'thorn', 'violet', 'wave', 'yarrow',
  'badger', 'cinder', 'dawn', 'echo', 'fern', 'glade', 'heron', 'inlet',
  'jasper', 'kite', 'lagoon', 'moss', 'nest', 'osprey', 'prairie', 'ridge',
] as const

/**
 * Unambiguous base32: no i/l/o/u and no 0/1, so a token read off a screen can
 * be typed back. 30 symbols.
 */
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789'
const TOKEN_LENGTH = 8

function pick<T extends readonly string[]>(list: T): string {
  const index = Math.floor(Math.random() * list.length)
  return list[index] ?? list[0]
}

/**
 * Uniform over the alphabet: rejection sampling, not modulo, so no symbol is
 * more likely than another. `crypto` because a predictable id would let one
 * client walk into another client's room.
 */
function randomToken(length = TOKEN_LENGTH): string {
  const limit = 256 - (256 % TOKEN_ALPHABET.length)
  let out = ''
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length - out.length))
    for (const byte of bytes) {
      if (byte < limit && out.length < length) {
        out += TOKEN_ALPHABET.charAt(byte % TOKEN_ALPHABET.length)
      }
    }
  }
  return out
}

/**
 * New rooms get a readable triple plus an unguessable token. The words alone
 * are only 32^3 = 32,768 combinations — enumerable in seconds — and knowing a
 * code is enough to walk into a call, so entry must also require the random
 * part (30^8 ≈ 6.6e11). Existing UUID-slice URLs keep working.
 */
export function generateRoomId(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(NOUNS)}-${randomToken()}`
}
