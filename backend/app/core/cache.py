"""A tiny bounded TTL map.

Used to make `/explain` idempotent per alert: the first call pays for a
completion, every later call for the same alert id gets the stored text back.
That is what "at most once per critical alert" means in practice, and it also
means a phone retrying after a dropped connection cannot quietly bill twice.

In-process and therefore lost on restart, which on a free Render instance is
often. The failure mode is one extra completion after a cold start, not a wrong
answer, so a database for this would be cost without benefit.
"""

from __future__ import annotations

import time
from collections import OrderedDict


class TTLCache:
    def __init__(self, max_size: int, ttl_seconds: float) -> None:
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._items: OrderedDict[str, tuple[float, str]] = OrderedDict()

    def get(self, key: str, now: float | None = None) -> str | None:
        current = time.monotonic() if now is None else now
        item = self._items.get(key)
        if item is None:
            return None
        expires_at, value = item
        if expires_at <= current:
            self._items.pop(key, None)
            return None
        self._items.move_to_end(key)
        return value

    def set(self, key: str, value: str, now: float | None = None) -> None:
        current = time.monotonic() if now is None else now
        self._items[key] = (current + self._ttl, value)
        self._items.move_to_end(key)
        while len(self._items) > self._max_size:
            self._items.popitem(last=False)

    def __len__(self) -> int:
        return len(self._items)
