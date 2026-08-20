/** Parse `--json` CLI stdout; tolerate leading log lines before the JSON blob. */
export function parseCliJson<T>(raw: string, label: string): T {
  const trimmed = raw.trim()
  const start = trimmed.search(/[{[]/)
  if (start === -1) {
    throw new Error(trimmed || `${label} returned no JSON`)
  }
  return JSON.parse(trimmed.slice(start)) as T
}
