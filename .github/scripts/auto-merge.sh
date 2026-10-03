#!/usr/bin/env bash
# Sprint 078 — Auto-Merge fuer agent/*-PRs (Beschluss Owner, 03.10.2026).
# Orchestriert nur: Fakten via gh sammeln, Entscheidung trifft die
# getestete Regel in server/auto-merge-gate.ts (Version vom Default-Branch,
# nicht aus dem PR — ein PR kann seine eigene Freigabe nicht umbiegen).
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY fehlt}"
BRANCH="${1:?Nutzung: auto-merge.sh <head-branch>}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1) Offenen PR auf main fuer diesen Head-Branch suchen.
NUMBER="$(
  gh pr list --repo "$REPO" --state open --base main --head "$BRANCH" \
    --json number --jq '.[0].number // empty'
)"
if [ -z "${NUMBER:-}" ]; then
  echo "Kein offener agent-PR auf main fuer $BRANCH — nichts zu tun."
  exit 0
fi
echo "PR #$NUMBER fuer $BRANCH gefunden — Fakten sammeln."

# 2) PR-Fakten + Check-Rollup abrufen.
gh pr view "$NUMBER" --repo "$REPO" \
  --json state,isDraft,baseRefName,headRefName,statusCheckRollup \
  > "$WORK/pr.json"

# 3) Geaenderte Dateien (max. 3000, gh deckt normale PRs vollstaendig ab).
gh pr diff "$NUMBER" --repo "$REPO" --name-only > "$WORK/files.txt"

# 4) Fakten fuer das Regelmodul bauen (leere Check-Ergebnisse = null).
jq -n \
  --rawfile pr "$WORK/pr.json" \
  --rawfile files "$WORK/files.txt" \
  '{
    branch: $pr.headRefName,
    state: $pr.state,
    isDraft: $pr.isDraft,
    base: $pr.baseRefName,
    changedFiles: ($files | split("\n") | map(select(length > 0))),
    checks: ($pr.statusCheckRollup // [] | map({
      name: .name,
      conclusion: (.conclusion // null)
    }))
  }' > "$WORK/facts.json"

# 5) Entscheidung nach der getesteten Regel (main-Version).
DECISION="$(npx --yes tsx@4 server/auto-merge-gate.ts --input "$WORK/facts.json")"
MERGE="$(echo "$DECISION" | jq -r '.merge')"
REASON="$(echo "$DECISION" | jq -r '.reason')"
echo "Auto-Merge-Gate: merge=$MERGE — $REASON"

if [ "$MERGE" != "true" ]; then
  exit 0
fi

# 6) Squash-Merge + Branch aufraeumen; Race-Toleranz falls schon gemerged.
if gh pr merge "$NUMBER" --repo "$REPO" --squash --delete-branch; then
  echo "PR #$NUMBER automatisch gemerged (dokumentierte Ausnahme)."
else
  STATE="$(gh pr view "$NUMBER" --repo "$REPO" --json state --jq '.state')"
  if [ "$STATE" = "MERGED" ]; then
    echo "PR #$NUMBER wurde zwischenzeitlich bereits gemerged."
    exit 0
  fi
  echo "Merge von PR #$NUMBER schlug fehl (Status: $STATE)." >&2
  exit 1
fi
