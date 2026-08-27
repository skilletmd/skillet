#!/usr/bin/env bash
# Skillet Daily: sweep the day's signal here, write the cards, post them to prod.
#
#   pnpm daily              collect + write + post as DRAFTS to skillet.md
#   pnpm daily --publish    ... and put them straight on the feed
#   pnpm daily --local      write to the local blog.db instead (dev loop)
#   pnpm daily --dry-run    show the clusters, call no API, write nothing
#
# Runs from a laptop on purpose. The keys live here, not on the server: the
# collector needs twitterapi.io, the writer needs Anthropic, and reading a
# skill's README wants a GitHub token. Prod holds none of them and only accepts
# the finished edition over POST /api/admin/stories.
#
# Drafts by default. Publishing is a decision, so it is a flag.
set -euo pipefail
cd "$(dirname "$0")/.."

PUBLISH=0
LOCAL=0
PASSTHRU=()
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --local)   LOCAL=1 ;;
    *)         PASSTHRU+=("$arg") ;;
  esac
done

[ -f .env ] && { set -a; . ./.env; set +a; }

# The writer's key already lives in the registry's env; there is no second copy.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -f ../registry/.env ]; then
  ANTHROPIC_API_KEY=$(grep -m1 '^ANTHROPIC_API_KEY=' ../registry/.env | cut -d= -f2- | tr -d '"'"'"'')
  export ANTHROPIC_API_KEY
fi
# Optional: only buys the tree API, which finds SKILL.md nested in a directory.
if [ -z "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  GITHUB_TOKEN=$(gh auth token 2>/dev/null || true)
  export GITHUB_TOKEN
fi

: "${TWITTERAPI_IO_KEY:?set TWITTERAPI_IO_KEY in packages/web/.env — without it the sweep reaches Hacker News and nothing else}"

if [ "$LOCAL" -eq 0 ]; then
  export STORY_PUBLISH_URL="${STORY_PUBLISH_URL:-https://skillet.md}"
  # Read prod's token from prod, so there is one copy of it and it is there.
  if [ -z "${STORY_PUBLISH_TOKEN:-}" ]; then
    STORY_PUBLISH_TOKEN=$(ssh -o BatchMode=yes skillet \
      'grep -m1 "^SKILLET_STORY_PUBLISH_TOKEN=" ~/knox/packages/web/.env | cut -d= -f2-')
    export STORY_PUBLISH_TOKEN
  fi
  [ -n "${STORY_PUBLISH_TOKEN:-}" ] || { echo "could not read the publish token from prod" >&2; exit 1; }
fi
[ "$PUBLISH" -eq 1 ] || export STORY_DRAFT_ONLY=1

echo "== collecting =="
node scripts/collect-signal.mjs

if [ "$LOCAL" -eq 0 ]; then
  echo
  echo "== uploading collection =="
  # The raw posts under the stories. Without this only the written cards reach
  # prod, and the quote rows there stay frozen at whatever the committed seed
  # last held.
  curl -fsS -X POST "$STORY_PUBLISH_URL/api/admin/signal" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer $STORY_PUBLISH_TOKEN" \
    --data-binary @content/news-signal.json
  echo
fi

echo
echo "== writing =="
node scripts/draft-stories.mjs "${PASSTHRU[@]+"${PASSTHRU[@]}"}"

if [ "$LOCAL" -eq 0 ] && [ "$PUBLISH" -eq 0 ]; then
  echo
  echo "Drafts. Review at https://skillet.md/admin/blog, or re-run with --publish."
fi
