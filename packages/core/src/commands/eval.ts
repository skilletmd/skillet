/**
 * `skillet eval [slug]` — run the v1 static basic eval against kit skill(s).
 */
import { runBasicEval, EvalError } from '@skillet/protocol';
import { readBundleFromSkillStore, readState } from '../kit/store.js';

export interface EvalSkillResult {
  slug: string;
  status: 'passed' | 'failed' | 'none';
  case_results?: Array<{ id: string; passed: boolean; missing?: string[] }>;
}

export async function evalSkills(slugs?: string[]): Promise<EvalSkillResult[]> {
  const state = await readState();
  const targets =
    slugs && slugs.length > 0
      ? slugs
      : Object.keys(state.skills);

  if (targets.length === 0) {
    throw new Error('No skills in kit. Import a skill first.');
  }

  const results: EvalSkillResult[] = [];

  for (const slug of targets) {
    if (!state.skills[slug]) {
      throw new Error(`Skill "${slug}" not found in kit.`);
    }
    const bundle = await readBundleFromSkillStore(slug);
    try {
      const run = runBasicEval(bundle);
      results.push({
        slug,
        status: run.status,
        ...(run.case_results ? { case_results: run.case_results } : {}),
      });
    } catch (err) {
      if (err instanceof EvalError) {
        throw new Error(`${slug}: ${err.message}`);
      }
      throw err;
    }
  }

  return results;
}
