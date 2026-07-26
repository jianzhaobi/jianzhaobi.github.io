#!/usr/bin/env python3
"""Regression checks for the single-file smoke map and cache timeline."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from cache_timeline import timeline_hours


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PROJECT_ROOT.parent
INDEX_PATH = PROJECT_ROOT / "index.html"
WORKFLOW_PATH = REPOSITORY_ROOT / ".github/workflows/deploy-pages-with-smoke-cache.yml"


def frames_for(hours_by_dataset: dict[str, set[int]]) -> list[SimpleNamespace]:
    return [
        SimpleNamespace(
            dataset=dataset,
            hour=hour,
            key=f"{dataset}:{hour}",
        )
        for dataset, hours in hours_by_dataset.items()
        for hour in hours
    ]


class TimelineHoursTests(unittest.TestCase):
    def test_keeps_all_contiguous_hours_on_each_side_of_now(self) -> None:
        datasets = ["smoke", "total"]
        frames = frames_for({
            "smoke": set(range(-3, 7)),
            "total": set(range(-3, 6)),
        })
        successful = {frame.key for frame in frames}

        self.assertEqual(
            timeline_hours(frames, successful, datasets),
            list(range(-3, 6)),
        )

    def test_stops_at_first_gap_independently_in_each_direction(self) -> None:
        datasets = ["smoke", "total"]
        common = {-4, -3, -1, 0, 1, 2, 4}
        frames = frames_for({dataset: common for dataset in datasets})
        successful = {frame.key for frame in frames}

        self.assertEqual(
            timeline_hours(frames, successful, datasets),
            [-1, 0, 1, 2],
        )

    def test_requires_current_hour_for_every_dataset(self) -> None:
        datasets = ["smoke", "total"]
        frames = frames_for({
            "smoke": {-1, 0, 1},
            "total": {-1, 1},
        })
        successful = {frame.key for frame in frames}

        self.assertEqual(
            timeline_hours(frames, successful, datasets),
            [],
        )


class StaticAppContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_PATH.read_text(encoding="utf-8")

    def test_embedded_javascript_parses(self) -> None:
        inline_script = self.index.rsplit("<script>", 1)[1].split("</script>", 1)[0]
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as handle:
            handle.write(inline_script)
            handle.flush()
            result = subprocess.run(
                ["node", "--check", handle.name],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_reliability_guards_remain_public_and_compatible(self) -> None:
        self.assertNotIn("map._popup", self.index)
        self.assertNotIn("AbortSignal.timeout", self.index)
        self.assertNotIn("quiet: true", self.index)
        self.assertIn(
            "Math.floor(clientNow.getTime() / HOUR) * HOUR",
            self.index,
        )

    def test_rolling_cache_uses_a_unique_save_key(self) -> None:
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        unique_key = (
            "raqdps-v5-${{ steps.model-cycle.outputs.cycle }}-"
            "${{ github.run_id }}"
        )
        self.assertGreaterEqual(workflow.count(unique_key), 2)
        save_step = workflow.split("- name: Save rolling frame cache", 1)[1]
        self.assertNotIn("cache-hit", save_step.split("- name:", 1)[0])


if __name__ == "__main__":
    unittest.main()
