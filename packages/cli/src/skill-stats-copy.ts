/**
 * Skill-stats confirmation copy, shared by the first-run consent ask
 * (route-hooks-consent.ts) and `skillet activity choose` so the two surfaces
 * cannot drift. Honesty contract: the local tally is unconditional; these
 * strings only ever describe the SYNC choice.
 */
export const STATS_SYNC_ON_MSG = "Syncing skill stats. Change anytime with `skillet activity off`";
export const STATS_LOCAL_MSG = "Skill stats stay on this machine.";
