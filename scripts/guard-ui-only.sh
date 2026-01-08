#!/bin/bash
# UI-Only Guard Script
# Blocks non-UI changes for Lovable branch merges.
# Usage: ./scripts/guard-ui-only.sh <base-branch> <head-branch>
#
# Allowed paths for UI-only changes:
# - client/src/components/**
# - client/src/pages/**
# - client/src/styles/**
# - client/src/lib/utils.ts (UI utilities only)
# - client/index.html
# - client/public/**
# - *.css, *.scss (stylesheets)

set -e

BASE_BRANCH="${1:-main}"
HEAD_BRANCH="${2:-HEAD}"

echo "========================================="
echo "  UI-Only Guard Check"
echo "========================================="
echo "Base: $BASE_BRANCH"
echo "Head: $HEAD_BRANCH"
echo ""

# Get list of changed files
CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"..."$HEAD_BRANCH" 2>/dev/null || git diff --name-only "$BASE_BRANCH" "$HEAD_BRANCH")

if [ -z "$CHANGED_FILES" ]; then
  echo "No changed files detected."
  exit 0
fi

# Define allowed patterns (UI-only)
ALLOWED_PATTERNS=(
  "^client/src/components/"
  "^client/src/pages/"
  "^client/src/styles/"
  "^client/src/lib/utils\.ts$"
  "^client/index\.html$"
  "^client/public/"
  "\.css$"
  "\.scss$"
  "^attached_assets/"
  "^\.gitignore$"
)

# Define explicitly blocked patterns
BLOCKED_PATTERNS=(
  "^server/"
  "^shared/"
  "^client/src/hooks/"
  "^client/src/lib/queryClient"
  "^client/src/integrations/"
  "^scripts/"
  "^\.github/"
  "^package\.json$"
  "^package-lock\.json$"
  "^tsconfig"
  "^vite\.config"
  "^drizzle"
  "^\.replit$"
  "^replit\.nix$"
)

VIOLATIONS=()
ALLOWED=()

for file in $CHANGED_FILES; do
  is_allowed=false
  is_blocked=false
  
  # Check if explicitly blocked
  for pattern in "${BLOCKED_PATTERNS[@]}"; do
    if echo "$file" | grep -qE "$pattern"; then
      is_blocked=true
      break
    fi
  done
  
  if [ "$is_blocked" = true ]; then
    VIOLATIONS+=("$file")
    continue
  fi
  
  # Check if explicitly allowed
  for pattern in "${ALLOWED_PATTERNS[@]}"; do
    if echo "$file" | grep -qE "$pattern"; then
      is_allowed=true
      break
    fi
  done
  
  if [ "$is_allowed" = true ]; then
    ALLOWED+=("$file")
  else
    # Not explicitly allowed or blocked - treat as violation for safety
    VIOLATIONS+=("$file")
  fi
done

echo "Allowed changes:"
if [ ${#ALLOWED[@]} -eq 0 ]; then
  echo "  (none)"
else
  for file in "${ALLOWED[@]}"; do
    echo "  [OK] $file"
  done
fi

echo ""

if [ ${#VIOLATIONS[@]} -gt 0 ]; then
  echo "BLOCKED changes (not UI-only):"
  for file in "${VIOLATIONS[@]}"; do
    echo "  [BLOCKED] $file"
  done
  echo ""
  echo "========================================="
  echo "  UI-ONLY GUARD FAILED"
  echo "========================================="
  echo ""
  echo "This branch contains non-UI changes that are not allowed"
  echo "from the ui-lovable branch. Please remove or revert:"
  echo ""
  for file in "${VIOLATIONS[@]}"; do
    echo "  - $file"
  done
  echo ""
  echo "Backend, hooks, and schema changes must go through dev branch"
  echo "with human review."
  exit 1
else
  echo "========================================="
  echo "  UI-ONLY GUARD PASSED"
  echo "========================================="
  exit 0
fi
