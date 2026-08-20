/** Unix mode bits are meaningful for owner-only secrets; Windows ACLs differ. */
export function enforcesUnixFilePermissions(): boolean {
  return process.platform !== "win32";
}
