#!/usr/bin/env bash
set -euo pipefail

# Release Check Script for Agenten-Villa
# Runs check, test, and build in sequence, collects results, and prints summary.
# Exit code 0 if all steps succeed, non-zero if any step fails.

CHECK_STATUS="FAIL"
TEST_STATUS="FAIL"
BUILD_STATUS="FAIL"

PNPM_CMD="pnpm"
if ! command -v pnpm &> /dev/null; then
  PNPM_CMD="npx --yes pnpm@10.4.1"
fi

echo "=================================================="
echo "         AGENTEN-VILLA RELEASE CHECK"
echo "=================================================="
echo ""

echo "[1/3] Running TypeScript typecheck (pnpm check)..."
if $PNPM_CMD check; then
  CHECK_STATUS="OK"
  echo "✓ Typecheck passed."
else
  echo "✗ Typecheck failed."
fi
echo ""

echo "[2/3] Running Vitest test suite (pnpm test)..."
if NODE_ENV=test env -u OPENAI_API_KEY -u GEMINI_API_KEY $PNPM_CMD test; then
  TEST_STATUS="OK"
  echo "✓ Tests passed."
else
  echo "✗ Tests failed."
fi
echo ""

echo "[3/3] Running Production Build (pnpm build)..."
if $PNPM_CMD build; then
  BUILD_STATUS="OK"
  echo "✓ Build passed."
else
  echo "✗ Build failed."
fi
echo ""

echo "=================================================="
echo "              SUMMARY & RELEASE STATUS"
echo "=================================================="
echo "  TypeScript Check (pnpm check):      [ $CHECK_STATUS ]"
echo "  Unit/Integration Tests (pnpm test): [ $TEST_STATUS ]"
echo "  Production Build (pnpm build):      [ $BUILD_STATUS ]"
echo "=================================================="

if [ "$CHECK_STATUS" = "OK" ] && [ "$TEST_STATUS" = "OK" ] && [ "$BUILD_STATUS" = "OK" ]; then
  echo "RELEASE CHECK SUCCESSFUL — ALL STEPS PASSED!"
  exit 0
else
  echo "RELEASE CHECK FAILED — ONE OR MORE STEPS FAILED!"
  exit 1
fi
