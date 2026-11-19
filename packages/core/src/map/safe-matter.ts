/**
 * gray-matter options that never run front matter as code.
 *
 * gray-matter evaluates `---js` front matter by default. The map scan reads
 * every skill on the computer and the merge step reads what a model wrote, and
 * neither ever runs one: such front matter throws, which each caller treats as
 * front matter it couldn't read. Passing options also keeps gray-matter from
 * caching every SKILL.md it parses.
 */
function refuseCode(): never {
  throw new Error("front matter that runs code is not read");
}

export const SAFE_MATTER = { engines: { javascript: refuseCode, js: refuseCode } };
