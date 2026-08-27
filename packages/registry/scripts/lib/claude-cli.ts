/**
 * Shared headless `claude` CLI transport for local ops scripts.
 *
 * Extracted from claude-cli-classify.ts when a second script (suggestion
 * phrasing) needed the same subprocess handling. Behaviour is unchanged: this
 * is the same spawn, the same JSON-envelope unwrap, and the same plain-text
 * fallback that classification has been running against.
 *
 * LOCAL OPS ONLY. Nothing under `src/` may import this — the registry server
 * has no `claude` binary and must not depend on one. Same boundary
 * `src/classify` and `scripts/lib/claude-cli-classify.ts` already draw.
 */
import { spawn } from 'node:child_process';

/** Cheap + fast tier. Both classification and phrasing are small decisions. */
export const CLI_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Run one `claude -p` invocation and return its `result` text.
 *
 * stdin is `ignore`d rather than inherited: the CLI waits on stdin for a few
 * seconds when it is a pipe, which turns a batch loop into a stall.
 */
export function runClaudeCli(prompt: string, model: string = CLI_MODEL): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', prompt, '--output-format', 'json', '--model', model],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      try {
        const env = JSON.parse(stdout) as { result?: string };
        resolve(env.result ?? '');
      } catch {
        // Non-JSON stdout (older CLI, or a plain-text fallback) — use as-is.
        resolve(stdout);
      }
    });
  });
}

/** True when the `claude` CLI is available on PATH (checked before a run). */
export function claudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
