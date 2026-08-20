import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return sha256(buf);
}

export function hashRef(hash: string): string {
  return `sha256:${hash}`;
}
