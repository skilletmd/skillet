/**
 * Interactive approval prompt for graded skill-update diffs.
 *
 * Security invariants:
 *   - Default answer is N (deny). The user must explicitly type "y" or "yes".
 *   - Non-interactive / non-TTY contexts return false immediately.
 *     Callers must exit non-zero when running in CI and approval is required.
 *   - The diff is always printed before prompting, so the user sees what they
 *     are approving. Callers must not suppress the diff.
 */

import { createInterface } from "node:readline";
import type { Writable, Readable } from "node:stream";

/**
 * Prints diff to output, then asks the user to approve.
 *
 * Returns true iff the user explicitly answered "y" or "yes" (case-insensitive).
 * Returns false on EOF, non-TTY output, or any other answer.
 *
 * Pass process.stdout / process.stdin for production; pass mock streams in tests.
 */
export type ApprovalPromptKind = "install" | "update";

export async function promptApproval(
  diff: string,
  output: Writable,
  input: Readable,
  kind: ApprovalPromptKind = "update",
): Promise<boolean> {
  output.write(diff + "\n");

  // Non-TTY: no interactive terminal available — auto-deny.
  // Caller is responsible for exiting non-zero.
  const isTTY = (output as NodeJS.WriteStream).isTTY === true;
  if (!isTTY) {
    output.write(
      "\nNon-interactive terminal: approvals must be recorded in the lock file before running in CI.\n"
    );
    return false;
  }

  const question =
    kind === "install"
      ? "\nInstall this skill? [y/N] "
      : "\nApprove this skill update? [y/N] ";

  return new Promise<boolean>((resolve) => {
    output.write(question);

    const rl = createInterface({ input, output, terminal: false });

    // settled guards against close firing synchronously inside rl.close()
    // (which would invoke the close handler before the line handler finishes)
    let settled = false;

    rl.once("line", (line: string) => {
      settled = true;
      rl.close();
      const answer = line.trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });

    rl.once("close", () => {
      if (!settled) resolve(false); // EOF without a line = deny
    });
  });
}
