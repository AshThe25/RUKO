"""Repo-root anchoring for every script in ml/.

WHY THIS EXISTS: the scripts used to mix two conventions. `generate.py` took
`--out data` (relative to the *current working directory*) while `train.py`
defaulted to `ml/data/processed` (relative to the *repo root*). Run them from
different directories and generate.py would happily write a fresh dataset to
./data/ while train.py silently trained on the stale copy in ml/data/ — no
error, no warning, just a published number that does not correspond to the
data anyone thinks produced it.

That cost a real training run. Every default path in ml/ now resolves through
here, so the working directory can no longer change what a script reads.
"""

from pathlib import Path

#: ml/paths.py -> ml/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[1]

ML_DIR = REPO_ROOT / "ml"
DATA_DIR = ML_DIR / "data"
PROCESSED_DIR = DATA_DIR / "processed"
DERIVED_DIR = DATA_DIR / "derived"
MANIFEST = DATA_DIR / "manifest.json"
HOLDOUT = ML_DIR / "datasets" / "holdout" / "test_holdout.jsonl"
MODEL_DIR = ML_DIR / "models" / "ruko-manip-v1"


def resolve(path: Path | str) -> Path:
    """Interpret a user-supplied path relative to the repo root, not the cwd.

    An absolute path is returned untouched, so `--out /tmp/x` still works.
    """
    p = Path(path)
    return p if p.is_absolute() else (REPO_ROOT / p)
