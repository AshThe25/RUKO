#!/usr/bin/env bash
# Run the risk / agent / tools test suites (Vedant's scope).
#
# Uses Node's built-in test runner and native TypeScript type stripping, so it
# needs no package.json, no jest, and no install step. Requires Node >= 22.6.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== contract drift check =="
python3 mobile/src/contracts/sync_contracts.py --check

echo
echo "== risk / agent / tools tests =="
node --test "mobile/src/**/__tests__/*.test.ts"
