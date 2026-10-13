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

function pick<T extends readonly string[]>(list: T): string {
  const index = Math.floor(Math.random() * list.length)
  return list[index] ?? list[0]
}

/** New rooms get a readable triple. Existing UUID-slice URLs keep working. */
export function generateRoomId(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(NOUNS)}`
}
