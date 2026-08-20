import type {
  UploadLocalSkillsResult,
  UploadProgressEvent,
} from "@skillet/core";
import {
  printAddError,
  printStepInfo,
  printStepSuccess,
} from "../cli-add-present.js";

// Shared upload presentation, used by both `skillet upload` and the publish
// step folded into `skillet import`. Lives here (not in upload-cmd) so import
// can reuse it without an import cycle — upload-cmd imports `confirm` from
// import-cmd.

/** Bare slug for display — strip a single promoted `@owner/slug` prefix. */
export function displaySlug(stateKey: string): string {
  const m = /^@([^/]+)\/(.+)$/.exec(stateKey);
  return m ? m[2]! : stateKey;
}

export function registryRef(owner: string, stateKey: string): string {
  return `@${owner}/${displaySlug(stateKey)}`;
}

export function renderUploadProgress(event: UploadProgressEvent): void {
  const label = displaySlug(event.slug);
  if (event.phase === "start") {
    printStepInfo(`Uploading ${label}…`);
    return;
  }
  if (event.phase === "fail") {
    printAddError(`${label}: ${event.error}`);
    return;
  }
  if (event.alreadyExists) {
    printStepInfo(`${label} unchanged on profile`);
    return;
  }
  printStepSuccess(`${label} → ${registryRef(event.owner, event.slug)}`);
}

export function summarizeUploadResult(
  result: UploadLocalSkillsResult,
  visibility: "private" | "public",
): string {
  const vis = visibility === "public" ? "public" : "private";
  const publishedNew = result.published.filter((p) => !p.alreadyExists).length;
  const unchanged = result.published.filter((p) => p.alreadyExists).length;
  const failed = result.failed.length;
  const parts: string[] = [];
  if (publishedNew > 0) {
    parts.push(`${publishedNew} published`);
  }
  if (unchanged > 0) {
    parts.push(`${unchanged} unchanged`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  const detail = parts.length > 0 ? parts.join(", ") : "0 skills";
  return `✓ ${detail} on @${result.owner} (${vis})`;
}
