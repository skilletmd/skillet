/**
 * Refuse symlink hops when reading from the canonical skill store.
 */

import { lstat, realpath } from "node:fs/promises";
import { join, relative } from "node:path";

export class SkillPathError extends Error {
  constructor(
    readonly code: "path_escape" | "symlink_refused",
    message: string,
  ) {
    super(message);
    this.name = "SkillPathError";
  }
}

/** Resolve a bundle-relative path under `skillDir`, refusing symlinks and escapes. */
export async function resolveSkillFilePath(
  skillDir: string,
  bundlePath: string,
): Promise<string> {
  const parts = bundlePath.split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new SkillPathError("path_escape", "empty bundle path");
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new SkillPathError("path_escape", `unsafe path segment: ${part}`);
    }
  }

  let current = skillDir;
  for (const part of parts) {
    current = join(current, part);
    const st = await lstat(current);
    if (st.isSymbolicLink()) {
      throw new SkillPathError("symlink_refused", `symlink refused: ${part}`);
    }
  }

  const rootReal = await realpath(skillDir);
  const targetReal = await realpath(current);
  const rel = relative(rootReal, targetReal);
  if (rel.startsWith("..")) {
    throw new SkillPathError("path_escape", "path escapes skill store");
  }
  return current;
}
