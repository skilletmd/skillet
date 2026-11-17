// Words the kit map and its previews share.

/** "1 skill", "2 skills"; `many` when the plural isn't the word plus an s. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const joinList = (items: readonly string[], last: string) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`

/** "a, b and c". */
export const andList = (items: readonly string[]) => joinList(items, 'and')

/** "a, b or c". */
export const orList = (items: readonly string[]) => joinList(items, 'or')

/** How often a skill ran in the window, as a preview line says it. */
export const runsText = (n: number) => (n === 0 ? 'never ran' : n === 1 ? '1 run' : `${n} runs`)
