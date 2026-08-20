// Run basic eval at registry publish and read eval status from version metadata.
import { runBasicEval, EvalError, type EvalStatus } from '@skillet/protocol';
import type { DecodedBundle } from '@skillet/protocol';

export { EvalError };

export function runPublishEval(bundle: DecodedBundle): EvalStatus {
  return runBasicEval(bundle).status;
}

export function evalStatusFromMetadataJson(metadataJson: string): EvalStatus {
  try {
    const meta = JSON.parse(metadataJson) as { eval?: unknown };
    if (meta.eval === 'passed' || meta.eval === 'failed' || meta.eval === 'none') {
      return meta.eval;
    }
  } catch {
    /* ignore */
  }
  return 'none';
}
