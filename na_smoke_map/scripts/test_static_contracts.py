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

    def test_wfigs_uses_one_canonical_snapshot(self) -> None:
        self.assertIn(
            'const FIRE_DATABASE_STORAGE_KEY = "na-smoke-map:wfigs-database:v3"',
            self.index,
        )
        self.assertIn("const canonicalFireRecords = new Map();", self.index)
        self.assertIn("return canonicalFireRecords.get(id);", self.index)
        self.assertIn("async function hydrateFireRecords(records, signal", self.index)
        self.assertIn("async function loadCurrentOnlyFeatures(signal)", self.index)
        self.assertIn("function mergeFireFeaturePage(ytdFeatures, pageSize, source)", self.index)
        self.assertIn('f: "geojson",', self.index)
        self.assertIn("returnGeometry: true,", self.index)
        self.assertNotIn("const live = fireEvents.get(record.id);", self.index)

    def test_wfigs_selection_reuses_canonical_geometry(self) -> None:
        selection = self.index.split(
            "function selectDatabaseFire(record)",
            1,
        )[1].split("function zoomToComplex(record)", 1)[0]
        complex_zoom = self.index.split(
            "function zoomToComplex(record)",
            1,
        )[1].split("function setSmokeVisibility", 1)[0]
        self.assertIn(
            "canonicalFireRecords.get(record.id) !== record",
            selection,
        )
        self.assertIn("renderFireSelection(record)", selection)
        self.assertNotIn("fetchArcgis", selection)
        self.assertNotIn("fetchGeojsonFeaturePages", selection)
        self.assertNotIn("fetchArcgis", complex_zoom)
        self.assertNotIn("fetchGeojsonFeaturePages", complex_zoom)
        self.assertIn(
            "wildfiresVisible && perimetersVisible && record.perimeterFeatures.length",
            self.index,
        )
        self.assertIn(
            "wildfiresVisible && ignitionsVisible && record.pointFeature",
            self.index,
        )

    def test_wfigs_status_filter_fills_pages_after_final_membership(self) -> None:
        collector = self.index.split(
            "async function collectFilteredStatusPage(",
            1,
        )[1].split(
            "// The default filter state",
            1,
        )[0]
        self.assertIn("resultRecordCount: scanSize + 1", collector)
        self.assertLess(
            collector.index("await resolveCurrentMembership(records, signal)"),
            collector.index("fireMatchesDatabaseFilters(record)"),
        )
        self.assertLess(
            collector.index("hydratePerimeterFilterAttributes(records, \"ytd\", signal)"),
            collector.index("fireMatchesDatabaseFilters(record)"),
        )
        self.assertIn("FIRE_NOT_CURRENT_SCAN_SIZE", collector)
        self.assertIn(
            "nextHasMore = nextBufferedRecords.length > 0 || !nextSourceExhausted",
            self.index,
        )
        self.assertNotIn(
            'fireDatabaseStatus.textContent = fireDatabaseOffset ? "No more wildfires"',
            self.index,
        )

    def test_wfigs_imsr_excludes_official_end_dates(self) -> None:
        imsr_function = self.index.split(
            "function isImsrGradeFire(record)",
            1,
        )[1].split(
            "function fireMatchesDatabaseStatus",
            1,
        )[0]
        self.assertIn(
            "!(record.containment || record.control || record.out)",
            imsr_function,
        )
        self.assertIn(
            '" AND ContainmentDateTime IS NULL"',
            self.index,
        )
        self.assertIn(
            '" AND ControlDateTime IS NULL"',
            self.index,
        )
        self.assertIn(
            '" AND FireOutDateTime IS NULL"',
            self.index,
        )

    def test_wfigs_hydration_uses_bounded_parallel_cached_batches(self) -> None:
        self.assertIn("async function mapWithConcurrency(items, limit, callback)", self.index)
        self.assertIn("const FIRE_ARCGIS_BATCH_CONCURRENCY = 2;", self.index)
        self.assertIn("const FIRE_PERIMETER_BATCH_SIZE = 500;", self.index)
        self.assertIn("const usePost = requestUrl.href.length > 1800;", self.index)
        self.assertIn('"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"', self.index)
        self.assertIn("async function fetchServiceObjectIds(service, signal)", self.index)
        self.assertIn("const fireDatabaseMembershipCache = new Map();", self.index)
        self.assertIn('const cacheKey = `current-only|${where}`;', self.index)
        self.assertIn("const unifiedImsrAll =", self.index)
        self.assertIn("const [ytdPage, currentPage] = await Promise.all([", self.index)
        initialize = self.index.split(
            "async function initialize()",
            1,
        )[1].split("initialize();", 1)[0]
        self.assertIn("loadFireDatabase(true);", initialize)
        self.assertNotIn("refreshWildfires({ force: true });", initialize)
        automatic_refresh = self.index.split(
            "function checkWildfiresAfterResume()",
            1,
        )[1].split("document.addEventListener", 1)[0]
        self.assertIn("loadFireDatabase(true);", automatic_refresh)
        self.assertNotIn("refreshWildfires", automatic_refresh)
        self.assertIn(".filter(fireFeatureMatchesDatabaseModifiers)", self.index)
        self.assertIn("const fireDatabasePerimeterCache = new Map();", self.index)
        self.assertIn("const fireDatabasePerimeterAttributeCache = new Map();", self.index)
        self.assertIn("const fireDatabaseComplexMemberCache = new Map();", self.index)
        self.assertIn(
            'const cacheKey = `${source}:${record.id}`;',
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
