/**
 * Compile-guard (U3 / AE2) — proves a raw wire ref or plain string can NOT
 * stand in for a branded `SkillId`.
 *
 * This file is intentionally NOT a `*.test.ts`, so the registry tsconfig does
 * NOT exclude it: it is part of the `tsc` build. If the brand ever regresses —
 * a plain `string` becomes assignable to `SkillId` — the `@ts-expect-error`
 * directives below go UNUSED and `tsc` fails with TS2578, breaking the build.
 * That failure is the guarantee. (Remove any one directive and the build fails
 * with the underlying assignability error instead — the compile-guard proof.)
 */
import { toSkillId, type SkillId } from '@skillet/protocol/skill-id';

// A `Set<SkillId>` is the canonical registry identity container — the shape of
// `subscribedSkillIds` and `pendingTargets`' `seen` in approvals.ts.
const ids = new Set<SkillId>();

// @ts-expect-error a raw wire ref (`@owner/slug`) is not a SkillId
ids.add('@owner/slug');

// @ts-expect-error a plain `owner:slug` string is not a SkillId until minted
ids.add('owner:slug');

// @ts-expect-error an arbitrary string is not a SkillId
ids.add('anything');

// The sole sanctioned mint compiles — the only way a value enters the set.
ids.add(toSkillId('@owner/slug'));

// A WHERE-param typed `SkillId` likewise rejects a raw string.
function whereById(_id: SkillId): void {
  /* identity WHERE param */
}

// @ts-expect-error a raw string cannot be passed where a SkillId param is expected
whereById('owner:slug');
whereById(toSkillId('owner:slug'));

/** Referenced so the guard container is never flagged as unused. */
export const __skillIdTypeGuardSize = (): number => ids.size;
