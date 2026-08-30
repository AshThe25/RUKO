#!/usr/bin/env python3
"""Fail loudly when a model's weights are missing, unverifiable, or ignored.

    python3 ml/verify_model_artifacts.py

WHY THIS EXISTS: .gitignore carries broad rules (`ml/models/**/*.onnx`, `*.pt`,
`*.safetensors`) so stray checkpoints stay out of the repository. The cost is
that a *new* model directory is swallowed in silence — `git add` reports
success and commits nothing. That is not hypothetical: manip-v1 shipped on the
lexicon for weeks because of it, and ruko-real-multisource-v1 currently has a
model card, metrics and a headline accuracy with no weights behind them
anywhere in the repository.

A results file is not a model. This makes the difference impossible to miss.

Three checks per model directory:
  1. the card declares an `artifacts` block at all;
  2. every declared artifact exists, and its sha256 matches the card;
  3. any weights present on disk are actually tracked by git, not silently
     ignored — the failure this script was written for.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = REPO_ROOT / "ml" / "models"
#: Weights that ship are bundled here, and for some models this is the *only*
#: committed copy — the fraud gate lives here and not under ml/models/.
APK_ASSETS = REPO_ROOT / "mobile" / "android" / "app" / "src" / "main" / "assets"
WEIGHT_SUFFIXES = {".onnx", ".pt", ".safetensors", ".bin"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_ignores(path: Path) -> bool:
    """True when git would silently drop this file from `git add`."""
    result = subprocess.run(
        ["git", "check-ignore", "-q", str(path)],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    return result.returncode == 0


def git_tracked(path: Path) -> bool:
    result = subprocess.run(
        ["git", "ls-files", "--error-unmatch", str(path)],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    return result.returncode == 0


def check_model(model_dir: Path) -> list[str]:
    problems: list[str] = []
    name = model_dir.name
    # Cards are named inconsistently across models — manip-v1 ships
    # onnx/model_card.json, the fraud gate ships onnx/onnx_card.json. Accept
    # either rather than reporting a missing model for a naming difference.
    card_path = next(
        (p for p in (
            model_dir / "onnx" / "model_card.json",
            model_dir / "onnx" / "onnx_card.json",
            model_dir / "model_card.json",
        ) if p.exists()),
        None,
    )
    if card_path is None:
        return [f"{name}: no model_card.json / onnx_card.json"]

    card = json.loads(card_path.read_text())
    artifacts = card.get("artifacts")

    # 1. A card with no artifacts block cannot be verified against anything.
    if not artifacts:
        status = card.get("status", "")
        detail = f" (status: {status})" if status else ""
        problems.append(
            f"BLOCK {name}: model_card.json declares no `artifacts` block{detail} "
            "— there is nothing to check the weights against"
        )
    else:
        # 2. Declared artifacts must exist and match.
        for filename, meta in artifacts.items():
            path = next(
                (p for p in (
                    model_dir / "onnx" / filename,
                    model_dir / filename,
                ) if p.exists()),
                None,
            )
            # A model may ship only into the APK, under a different filename.
            # Match on content, not on name, so a rename cannot fake a pass.
            if path is None and APK_ASSETS.is_dir():
                expected_hash = (meta or {}).get("sha256")
                if expected_hash:
                    for candidate in APK_ASSETS.glob("*.onnx"):
                        if sha256(candidate) == expected_hash:
                            path = candidate
                            break
            if path is None:
                problems.append(
                    f"WARN {name}: the card declares {filename}, which is not on "
                    "disk. Expected for the fp32 export, which is a ~90 MB build "
                    "product; a blocker if it was meant to ship."
                )
                continue
            expected = (meta or {}).get("sha256")
            if expected:
                actual = sha256(path)
                if actual != expected:
                    problems.append(
                        f"{name}: {filename} sha256 mismatch\n"
                        f"      card: {expected}\n"
                        f"      disk: {actual}"
                    )

            # The check above only proves the ml/ copy matches the card the
            # same export wrote -- that is tautological whenever the ml/ copy
            # exists, and it never touches the file that actually ships. A
            # shipped weight file can carry a different name in the APK than
            # in ml/ (the fraud gate's card also says "model_int8.onnx" but
            # ships as fraud_gate_int8.onnx), so this must not assume the
            # names line up: it only asks whether this exact model directory
            # is represented, by content, among what the APK actually bundles.
            # A directory that ships no int8 weights at all (fp32-only, or a
            # model not meant to ship yet) is not this check's concern -- that
            # is handled separately, below, by the tracked-weights check.
            if (
                expected
                and path.suffix == ".onnx"
                and "int8" in filename
                and APK_ASSETS.is_dir()
            ):
                apk_hashes = {sha256(c) for c in APK_ASSETS.glob("*.onnx")}
                if apk_hashes and expected not in apk_hashes:
                    problems.append(
                        f"BLOCK {name}: {filename} (sha256 {expected[:12]}...) is "
                        f"not present, under any filename, among the .onnx files "
                        f"actually bundled in {APK_ASSETS.relative_to(REPO_ROOT)} "
                        f"-- the app is running something else, or falling back "
                        f"to the lexicon."
                    )

    # 3. Weights the card says ship, which git is quietly ignoring.
    #
    # Scoped to *declared* artifacts on purpose. A model directory legitimately
    # holds build products that must never be committed — the fp32 export and
    # the PyTorch checkpoint are 90 MB each and only the int8 is shipped — so
    # flagging every ignored weight would cry wolf. The bug worth catching is
    # narrower: the card promises a file, and .gitignore silently drops it.
    for filename in (artifacts or {}):
        path = model_dir / "onnx" / filename
        if not path.exists():
            path = model_dir / filename
        if path.exists() and git_ignores(path) and not git_tracked(path):
            rel = path.relative_to(REPO_ROOT)
            problems.append(
                f"WARN {name}: the card declares {filename}, but .gitignore excludes "
                f"it. Fine when the file is a local build product (the fp32 export "
                f"is 90 MB and only int8 ships) — a blocker if it was meant to be "
                f"the shipped weights.\n"
                f"      to ship it: add `!{rel}` to .gitignore"
            )

    # A model that claims a headline number but ships no weights at all.
    tracked_weights = any(
        git_tracked(p)
        for p in model_dir.rglob("*")
        if p.is_file() and p.suffix in WEIGHT_SUFFIXES
    )
    # A model whose only committed copy is the bundled APK asset still ships.
    if not tracked_weights and artifacts:
        hashes = {(m or {}).get("sha256") for m in artifacts.values()}
        if APK_ASSETS.is_dir():
            tracked_weights = any(
                git_tracked(c) and sha256(c) in hashes
                for c in APK_ASSETS.glob("*.onnx")
            )
    if not tracked_weights:
        problems.append(
            f"BLOCK {name}: no weights tracked anywhere — this directory is a "
            "results report, not a shippable model. Its accuracy must not be "
            "quoted as something the app does."
        )

    return problems


def main() -> int:
    if not MODELS_DIR.exists():
        print("no ml/models directory", file=sys.stderr)
        return 0

    model_dirs = sorted(d for d in MODELS_DIR.iterdir() if d.is_dir())
    all_problems: dict[str, list[str]] = {}
    for model_dir in model_dirs:
        problems = check_model(model_dir)
        if problems:
            all_problems[model_dir.name] = problems

    print(f"checked {len(model_dirs)} model directories\n")
    if not all_problems:
        print("all models verify: weights present, tracked, and matching their card.")
        return 0

    for name, problems in all_problems.items():
        print(f"--- {name}")
        for problem in problems:
            print(f"  ! {problem}")
        print()

    blockers = sum(
        1 for v in all_problems.values() for p in v if p.startswith("BLOCK")
    )
    warnings = sum(
        1 for v in all_problems.values() for p in v if p.startswith("WARN")
    )
    print(f"{blockers} blocker(s), {warnings} warning(s).")
    # Only a blocker fails the check: a warning is a judgement call for a human,
    # and a script that cries wolf gets muted, which defeats the purpose.
    return 1 if blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())
