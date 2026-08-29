#!/usr/bin/env python3
"""Bundle docs/contracts/*.schema.ts into mobile/src/contracts/index.ts.

    python3 mobile/src/contracts/sync_contracts.py          # write
    python3 mobile/src/contracts/sync_contracts.py --check   # CI: fail on drift

WHY: docs/contracts/ is the canonical, reviewable spec and lives at the repo
root. React Native's Metro bundler will not resolve imports above the mobile/
project root without extra watchFolders config, and asking every teammate to
patch their bundler config is a bad trade. So the contracts are concatenated
into one generated file inside mobile/src/.

The generated file is committed. `--check` fails if it has drifted, so the two
can never disagree silently. **Edit docs/contracts/, never the generated file.**
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "docs" / "contracts"
OUT = ROOT / "mobile" / "src" / "contracts" / "index.ts"

# Dependency order: each file may only reference ones above it.
ORDER = ["common", "conversation", "payment", "risk", "investigation", "guardian"]

# Local `import ... from './x.schema'` lines become redundant once everything is
# in one module, so they are stripped. Imports from anywhere else are an error.
LOCAL_IMPORT = re.compile(r"^import\s+(?:type\s+)?\{[^}]*\}\s*from\s*'\./[\w.]+';\s*$",
                          re.MULTILINE | re.DOTALL)
ANY_IMPORT = re.compile(r"^import\s", re.MULTILINE)

HEADER = """/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Source of truth: docs/contracts/*.schema.ts
 * Regenerate:      python3 mobile/src/contracts/sync_contracts.py
 * Verify:          python3 mobile/src/contracts/sync_contracts.py --check
 *
 * This is the Ruko shared contract surface, bundled into one module so that
 * Metro resolves it without watchFolders configuration. Every workstream
 * imports its types from here.
 */
/* eslint-disable */
"""


def build() -> str:
    parts = [HEADER]
    for name in ORDER:
        path = SRC / f"{name}.schema.ts"
        text = path.read_text(encoding="utf-8")
        text = LOCAL_IMPORT.sub("", text)
        leftover = [m for m in ANY_IMPORT.finditer(text)]
        if leftover:
            line = text[: leftover[0].start()].count("\n") + 1
            sys.exit(f"error: {path.name}:{line} has a non-local import; "
                     "contracts must not depend on anything outside docs/contracts/")
        parts.append(f"\n// ===== docs/contracts/{name}.schema.ts "
                     f"{'=' * max(0, 48 - len(name))}\n")
        parts.append(text.strip() + "\n")
    return "".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    generated = build()
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != generated:
            print("CONTRACT DRIFT: mobile/src/contracts/index.ts is out of date.\n"
                  "Run: python3 mobile/src/contracts/sync_contracts.py", file=sys.stderr)
            return 1
        print("contracts in sync")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(generated, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(generated.splitlines())} lines "
          f"from {len(ORDER)} schema files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
