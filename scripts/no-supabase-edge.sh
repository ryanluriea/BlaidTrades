#!/bin/bash
set -e

echo "=== SINGLE CONTROL PLANE GUARDRAIL ==="
echo "Checking for prohibited Supabase Edge Function usage..."
echo ""

FAILED=0

echo "[CHECK 1] supabase.functions.invoke in client/src..."
if grep -rn "supabase\.functions\.invoke" client/src 2>/dev/null; then
  echo "FAIL: Found supabase.functions.invoke calls in client/src"
  echo "These must be migrated to Express endpoints."
  FAILED=1
else
  echo "PASS: No supabase.functions.invoke found"
fi
echo ""

echo "[CHECK 2] /functions/v1/ API calls in client/src..."
if grep -rn "/functions/v1/" client/src 2>/dev/null; then
  echo "FAIL: Found /functions/v1/ calls in client/src"
  echo "These are direct Supabase Edge Function calls and must be migrated."
  FAILED=1
else
  echo "PASS: No /functions/v1/ calls found"
fi
echo ""

echo "[CHECK 3] supabase.functions.invoke in server/..."
if grep -rn "supabase\.functions\.invoke" server 2>/dev/null; then
  echo "FAIL: Found supabase.functions.invoke calls in server/"
  echo "Backend must not call Supabase Edge Functions."
  FAILED=1
else
  echo "PASS: No supabase.functions.invoke in server/"
fi
echo ""

echo "[CHECK 4] Required Supabase env vars in production path..."
PROD_SUPABASE=$(grep -rn "SUPABASE_URL\|SUPABASE_ANON_KEY\|SUPABASE_SERVICE" server/index.ts server/routes.ts 2>/dev/null || true)
if [ -n "$PROD_SUPABASE" ]; then
  echo "WARNING: Found Supabase env var references in server core files:"
  echo "$PROD_SUPABASE"
  echo "Verify these are not required for production trading operations."
else
  echo "PASS: No Supabase env vars in production path"
fi
echo ""

echo "=== GUARDRAIL SUMMARY ==="
if [ $FAILED -eq 1 ]; then
  echo "FAILED: Split-brain risk detected. Fix the issues above."
  exit 1
else
  echo "PASSED: Single control plane enforced."
  echo "Express backend is the canonical authority for all state mutations."
  exit 0
fi
