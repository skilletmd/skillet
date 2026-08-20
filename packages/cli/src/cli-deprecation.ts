import { dim } from "./cli-colors.js";

/** Print a one-line stderr hint when a deprecated alias is invoked (TTY or not). */
export function printDeprecationHint(message: string): void {
  console.error(dim(message));
}
