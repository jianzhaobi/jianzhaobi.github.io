"""Pure helpers shared by the RAQDPS cache builder and regression tests."""

from __future__ import annotations

from typing import Protocol


class TimelineFrame(Protocol):
    key: str
    dataset: str
    hour: int


def timeline_hours(
    frames: list[TimelineFrame],
    successful_keys: set[str],
    datasets: list[str],
) -> list[int]:
    """Return every common contiguous hour around Now, without forcing symmetry."""
    available = {dataset: set() for dataset in datasets}
    for frame in frames:
        if frame.key in successful_keys:
            available[frame.dataset].add(frame.hour)
    common = set.intersection(*(available[dataset] for dataset in datasets)) if datasets else set()
    if 0 not in common:
        return []
    minimum_hour = 0
    maximum_hour = 0
    while minimum_hour - 1 in common:
        minimum_hour -= 1
    while maximum_hour + 1 in common:
        maximum_hour += 1
    return list(range(minimum_hour, maximum_hour + 1))
