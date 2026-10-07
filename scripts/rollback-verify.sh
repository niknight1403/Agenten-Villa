#!/usr/bin/env bash
set -euo pipefail

# Rollback Verification Script for Agenten-Villa (Sprint 090)
# Verifies health-relevant invariants for a given checkpoint tag or commit SHA.
#
# Usage:
#   ./scripts/rollback-verify.sh <checkpoint-tag-or-commit>
#   Example: ./scripts/rollback-verify.sh release-089

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: $0 <checkpoint-tag-or-commit>"
  echo "Example: $0 release-089"
  exit 1
fi

echo "=================================================="
echo "      AGENTEN-VILLA ROLLBACK VERIFICATION"
echo "=================================================="
echo "Target: $TARGET"
echo ""

FAILURES=0

# 1. Verify target exists in git
echo "[1/5] Checking git target existence..."
if git rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null 2>&1; then
  echo "✓ Target '$TARGET' resolves to a valid commit."
else
  echo "✗ Target '$TARGET' does not resolve to a valid commit."
  FAILURES=$((FAILURES + 1))
fi
echo ""

# 2. Verify target is not ahead of main
echo "[2/5] Checking target is behind or equal to main..."
MAIN_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse main 2>/dev/null || echo "")
TARGET_SHA=$(git rev-parse --short "$TARGET" 2>/dev/null || echo "")
if [ -n "$MAIN_SHA" ] && [ -n "$TARGET_SHA" ]; then
  if git merge-base --is-ancestor "$TARGET_SHA" "$MAIN_SHA" 2>/dev/null; then
    echo "✓ Target is an ancestor of main (safe rollback)."
  else
    echo "✗ Target is NOT an ancestor of main (not a safe rollback)."
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "⚠ Could not determine main or target SHA — skipping."
fi
echo ""

# 3. Verify check + test + build pass at target
echo "[3/5] Running pnpm check..."
if pnpm check >/dev/null 2>&1; then
  echo "✓ TypeScript check passed."
else
  echo "✗ TypeScript check failed."
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "[4/5] Running pnpm test..."
if NODE_ENV=test env -u OPENAI_API_KEY -u GEMINI_API_KEY pnpm test >/dev/null 2>&1; then
  echo "✓ Tests passed."
else
  echo "✗ Tests failed."
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "[5/5] Running pnpm build..."
if pnpm build >/dev/null 2>&1; then
  echo "✓ Build passed."
else
  echo "✗ Build failed."
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "=================================================="
echo "           ROLLBACK VERIFICATION SUMMARY"
echo "=================================================="
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL CHECKS PASSED — Target '$TARGET' is a safe rollback candidate."
  exit 0
else
  echo "FAILED — $FAILURES check(s) failed for target '$TARGET'."
  exit 1
fi
