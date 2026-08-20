import type {
  GroupSkillsByKitOptions,
  KitSkillGroup,
  KitState,
  SyncResult,
} from '@skillet/core';
import { groupSkillsByKit } from '@skillet/core';

export type SyncKitSkillStatus = 'synced' | 'skipped' | 'planned';

export interface SyncKitSkillJson {
  slug: string;
  status: SyncKitSkillStatus;
  reason?: string;
  token_count?: number;
  token_ambient?: number;
  token_method?: string;
}

export interface SyncKitGroupJson {
  kitRef: string;
  skills: SyncKitSkillJson[];
}

/** Kit groups for this device (manifest-scoped when items are provided). */
export function kitGroupsForDevice(
  state: KitState,
  manifestItems: GroupSkillsByKitOptions['manifestItems'],
): KitSkillGroup[] {
  const grouped = groupSkillsByKit(
    state,
    manifestItems !== undefined ? { manifestItems } : undefined,
  );
  return grouped.filter((g): g is KitSkillGroup & { kitRef: string } => g.kitRef !== null);
}

export function skipReasonsFromSyncResult(
  result: Pick<SyncResult, 'failed' | 'unionPull'>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of result.failed) {
    map.set(f.slug, f.reason);
  }
  for (const o of result.unionPull) {
    if (o.status === 'failed') {
      map.set(o.slug, o.reason ?? 'union_pull_failed');
    }
  }
  return map;
}

export function buildSyncKitsJson(
  groups: KitSkillGroup[],
  skipReasons: Map<string, string>,
  mode: 'synced' | 'planned',
): SyncKitGroupJson[] {
  return groups
    .filter((g): g is KitSkillGroup & { kitRef: string } => g.kitRef !== null)
    .map((g) => ({
      kitRef: g.kitRef,
      skills: g.skills.map((skill) => {
        // Context-weight stat carried from the manifest — additive, display only.
        const tokens = {
          ...(typeof skill.tokenCount === 'number' ? { token_count: skill.tokenCount } : {}),
          ...(typeof skill.tokenAmbient === 'number' ? { token_ambient: skill.tokenAmbient } : {}),
          ...(typeof skill.tokenMethod === 'string' ? { token_method: skill.tokenMethod } : {}),
        };
        const reason = skipReasons.get(skill.slug);
        if (reason) {
          return { slug: skill.slug, status: 'skipped' as const, reason, ...tokens };
        }
        return {
          slug: skill.slug,
          status: mode === 'planned' ? ('planned' as const) : ('synced' as const),
          ...tokens,
        };
      }),
    }));
}
