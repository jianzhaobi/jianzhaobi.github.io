#!/usr/bin/env python3
"""Regression checks for the single-file smoke map and cache timeline."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import build_hms_cache as hms_cache
import build_wildfire_cache as wildfire_cache
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

    def test_wfigs_uses_hourly_cache_and_one_canonical_snapshot(self) -> None:
        self.assertIn("./cache/wildfires/manifest.json", self.index)
        self.assertIn("function validWildfireCacheManifest(manifest)", self.index)
        self.assertIn("async function initializeWildfireCache(options = {})", self.index)
        self.assertIn("function startWildfireCatalogDownload()", self.index)
        self.assertIn("function wildfireCatalogWorkerSource()", self.index)
        self.assertIn('priority: "low"', self.index)
        self.assertIn('const DB_NAME = "na-smoke-map-wildfire-cache";', self.index)
        worker = self.index.split(
            "function wildfireCatalogWorkerSource()",
            1,
        )[1].split("function downloadWildfireCatalogInWorker", 1)[0]
        self.assertLess(worker.index("await readStored(version)"), worker.index("await fetch(url"))
        initializer = self.index.split(
            "async function initializeWildfireCache(options = {})",
            1,
        )[1].split("function sqlString", 1)[0]
        self.assertNotIn("wildfireDefaultRecords = null", initializer)
        self.assertIn("manifest.generatedAt !== previousVersion", initializer)
        csp = self.index.split(
            'http-equiv="Content-Security-Policy"',
            1,
        )[1].split(">", 1)[0]
        self.assertNotIn("https://services2.arcgis.com", csp)
        self.assertNotIn(
            "https://services3.arcgis.com",
            csp,
        )
        self.assertIn("const canonicalFireRecords = new Map();", self.index)
        self.assertIn("return canonicalFireRecords.get(id);", self.index)
        cached_loader = self.index.split(
            "async function loadFireDatabase(reset = false)",
            1,
        )[1].split("function openFireDrawer()", 1)[0]
        self.assertIn("wildfireDefaultRecords", cached_loader)
        self.assertIn("wildfireCatalogRecords", cached_loader)
        self.assertIn(".filter(fireMatchesDatabaseFilters)", cached_loader)
        self.assertNotIn("fetchArcgis", cached_loader)
        self.assertNotIn("FIRE_SERVICES", cached_loader)
        cache_inflater = self.index.split(
            "function fireRecordFromCache(wire)",
            1,
        )[1].split("async function inflateWildfireCacheRecords", 1)[0]
        self.assertIn("blankFireRecord", cache_inflater)
        self.assertIn("record.perimeterFeatures = wire.g", cache_inflater)
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

    def test_wfigs_filters_and_pagination_are_local(self) -> None:
        filters = self.index.split(
            "function fireMatchesDatabaseFilters(record)",
            1,
        )[1].split("function rebuildFireEvents()", 1)[0]
        self.assertIn("record.name", filters)
        self.assertIn("fireDatabaseLargeOnly", filters)
        self.assertIn("fireMatchesDatabaseStatus(record)", filters)
        self.assertIn("isImsrGradeFire(record)", filters)
        loader = self.index.split(
            "async function loadFireDatabase(reset = false)",
            1,
        )[1].split("function openFireDrawer()", 1)[0]
        self.assertIn("matching.slice(offset, offset + pageSize)", loader)
        self.assertIn("fireDatabaseTotal = matching.length;", loader)
        self.assertIn("wildfirePendingFilterReload = true;", loader)
        self.assertIn("Preparing full wildfire database", loader)

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

    def test_wfigs_startup_and_refresh_never_call_live_arcgis(self) -> None:
        initialize = self.index.split(
            "async function initialize()",
            1,
        )[1].split("initialize();", 1)[0]
        self.assertIn("initializeWildfireCache();", initialize)
        self.assertNotIn("fetchArcgis", initialize)
        refresh = self.index.split(
            "async function refreshWildfires(options = {})",
            1,
        )[1].split("const fireDateFormatter", 1)[0]
        self.assertIn("initializeWildfireCache({ force: true })", refresh)
        self.assertNotIn("FIRE_SERVICES", refresh)
        automatic_refresh = self.index.split(
            "function checkWildfiresAfterResume()",
            1,
        )[1].split("document.addEventListener", 1)[0]
        self.assertIn("initializeWildfireCache({ force: true });", automatic_refresh)
        self.assertNotIn("fetchArcgis", automatic_refresh)
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        self.assertIn("Build hourly WFIGS wildfire cache", workflow)
        self.assertIn("scripts/build_wildfire_cache.py", workflow)
        self.assertIn("_frame-cache/site-cache/wildfires/", workflow)

    def test_hms_uses_hourly_same_origin_cache_with_timeliness(self) -> None:
        self.assertIn("./cache/hms/manifest.json", self.index)
        self.assertIn("function validHmsCacheManifest(manifest)", self.index)
        self.assertIn("async function fetchHmsCacheAsset(", self.index)
        self.assertIn("function hmsReadyStatus()", self.index)
        self.assertIn("observed through", self.index)
        self.assertIn("cache checked", self.index)
        loader = self.index.split(
            "async function loadHmsSmoke(options = {})",
            1,
        )[1].split("function syncHmsAttribution", 1)[0]
        self.assertIn("fetchHmsCacheManifest", loader)
        self.assertIn("fetchHmsCacheAsset", loader)
        self.assertNotIn("fetchGeojsonFeaturePages", loader)
        self.assertNotIn("services2.arcgis.com", self.index)
        csp = self.index.split(
            'http-equiv="Content-Security-Policy"',
            1,
        )[1].split(">", 1)[0]
        self.assertIn("connect-src 'self'", csp)
        self.assertNotIn("services2.arcgis.com", csp)
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        self.assertIn("Build hourly NOAA HMS smoke cache", workflow)
        self.assertIn("scripts/build_hms_cache.py", workflow)
        self.assertIn("_frame-cache/site-cache/hms", workflow)
        refresh = self.index.split(
            "async function refreshAllData()",
            1,
        )[1].split("async function changeDataset()", 1)[0]
        self.assertIn("resetMapToInitialState();", refresh)
        self.assertIn("refreshHmsCache({ allowHidden: true })", refresh)
        self.assertIn("smokeReady && wildfiresReady && hmsReady", refresh)
        reset = self.index.split(
            "function resetMapToInitialState()",
            1,
        )[1].split("async function refreshAllData()", 1)[0]
        self.assertIn("setHmsVisibility(false);", reset)
        self.assertIn("Refresh smoke, wildfire, and HMS data", self.index)


class WildfireCacheBuilderTests(unittest.TestCase):
    @staticmethod
    def point(
        identifier: str,
        object_id: int,
        *,
        category: str = "WF",
        child: int = 0,
        parent: str | None = None,
        report: str | None = "U",
        containment: int | None = None,
    ) -> dict:
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-120, 45]},
            "properties": {
                "OBJECTID": object_id,
                "IrwinID": identifier,
                "IncidentName": identifier,
                "IncidentTypeCategory": category,
                "IsCpxChild": child,
                "CpxID": parent,
                "ICS209ReportStatus": report,
                "PercentContained": containment,
                "FireDiscoveryDateTime": 1_700_000_000_000 + object_id,
            },
        }

    @staticmethod
    def perimeter(identifier: str, object_id: int) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-120, 45], [-120, 46], [-119, 45], [-120, 45]]],
            },
            "properties": {
                "OBJECTID": object_id,
                "attr_IrwinID": identifier,
                "attr_IncidentTypeCategory": "WF",
            },
        }

    def test_builds_atomic_default_and_catalog_and_retains_prior_on_failure(self) -> None:
        current = [
            self.point("{a}", 1),
            self.point("{c}", 3, category="CX", report=None),
            self.point("{m}", 4, child=1, parent="{c}"),
        ]
        ytd = [
            self.point("{a}", 1),
            self.point("{b}", 2, report="F"),
            self.point("{c}", 3, category="CX", report=None),
            self.point("{m}", 4, child=1, parent="{c}"),
            self.point("{rx}", 5, category="RX"),
        ]
        sources = {
            "currentLocations": current,
            "currentPerimeters": [self.perimeter("{a}", 11)],
            "ytdLocations": ytd,
            "ytdPerimeters": [
                self.perimeter("{a}", 11),
                self.perimeter("{b}", 12),
                self.perimeter("{m}", 14),
                self.perimeter("{d}", 15),
            ],
        }

        def fake_fetch(name: str, _service: str, _retries: int) -> tuple:
            return name, sources[name], 1_700_000_000_000

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            args = SimpleNamespace(
                output=output,
                retries=1,
                jobs=2,
                fail_without_existing_cache=False,
            )
            with mock.patch.object(wildfire_cache, "fetch_source", side_effect=fake_fetch):
                wildfire_cache.build_cache(args)

            manifest_path = output / "manifest.json"
            manifest_bytes = manifest_path.read_bytes()
            manifest = wildfire_cache.json.loads(manifest_bytes)
            self.assertEqual(manifest["defaultCount"], 1)
            self.assertEqual(manifest["catalogCount"], 4)
            self.assertEqual(manifest["refreshIntervalMinutes"], 60)
            for name in ("default", "catalog"):
                asset = output / manifest[name]["path"]
                content = asset.read_bytes()
                self.assertEqual(len(content), manifest[name]["bytes"])
                self.assertEqual(
                    wildfire_cache.hashlib.sha256(content).hexdigest(),
                    manifest[name]["sha256"],
                )
            catalog = wildfire_cache.json.loads(
                (output / manifest["catalog"]["path"]).read_text(encoding="utf-8")
            )
            identifiers = {record["i"] for record in catalog["records"]}
            self.assertEqual(identifiers, {"a", "b", "c", "d"})
            complex_record = next(
                record for record in catalog["records"] if record["i"] == "c"
            )
            self.assertEqual([record["i"] for record in complex_record["m"]], ["m"])
            perimeter_only = next(
                record for record in catalog["records"] if record["i"] == "d"
            )
            self.assertIsNone(perimeter_only["p"])
            self.assertEqual(len(perimeter_only["g"]), 1)

            with mock.patch.object(
                wildfire_cache,
                "fetch_source",
                side_effect=RuntimeError("temporary WFIGS failure"),
            ), mock.patch.object(
                wildfire_cache.sys,
                "argv",
                ["build_wildfire_cache.py", "--output", str(output)],
            ):
                self.assertEqual(wildfire_cache.main(), 0)
            self.assertEqual(manifest_path.read_bytes(), manifest_bytes)

            (output / manifest["catalog"]["path"]).write_bytes(b"corrupt")
            with mock.patch.object(
                wildfire_cache,
                "fetch_source",
                side_effect=RuntimeError("temporary WFIGS failure"),
            ), mock.patch.object(
                wildfire_cache.sys,
                "argv",
                ["build_wildfire_cache.py", "--output", str(output)],
            ):
                self.assertEqual(wildfire_cache.main(), 1)

    def test_rolling_cache_uses_a_unique_save_key(self) -> None:
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        unique_key = (
            "raqdps-v5-${{ steps.model-cycle.outputs.cycle }}-"
            "${{ github.run_id }}"
        )
        self.assertGreaterEqual(workflow.count(unique_key), 2)
        save_step = workflow.split("- name: Save rolling frame cache", 1)[1]
        self.assertNotIn("cache-hit", save_step.split("- name:", 1)[0])


class HmsCacheBuilderTests(unittest.TestCase):
    @staticmethod
    def feature(
        density: str = "Light",
        start: str = "2026207 1200",
        end: str = "2026207 1500",
    ) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-120, 45],
                    [-120, 46],
                    [-119, 45],
                    [-120, 45],
                ]],
            },
            "properties": {
                "Density": density,
                "Satellite": "GOES-WEST",
                "Start": start,
                "End_": end,
            },
        }

    def test_parses_official_kml_fields_geometry_and_timestamps(self) -> None:
        kml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
        <description><![CDATA[<div>Start Time: 2026207 1200UTC<br>
        End Time: 2026207 1500UTC<br>Density: Heavy<br>
        Satellite: GOES-WEST</div>]]></description>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>
        -120,45,0 -120,46,0 -119,45,0 -120,45,0
        </coordinates></LinearRing></outerBoundaryIs></Polygon>
        </Placemark></Document></kml>"""
        features = hms_cache.parse_archive_kml(kml)
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["properties"]["Density"], "Heavy")
        self.assertEqual(features[0]["properties"]["Start"], "2026207 1200")
        self.assertEqual(features[0]["properties"]["End_"], "2026207 1500")
        self.assertEqual(features[0]["geometry"]["type"], "Polygon")
        start, end = hms_cache.observation_window(features)
        self.assertEqual(start, "2026-07-26T12:00:00Z")
        self.assertEqual(end, "2026-07-26T15:00:00Z")

    def test_empty_live_layer_falls_back_to_latest_archive(self) -> None:
        archive_feature = self.feature()
        now = hms_cache.dt.datetime(2026, 7, 27, 14, 0, tzinfo=hms_cache.UTC)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            args = SimpleNamespace(
                output=output,
                retries=1,
                archive_lookback_days=14,
                fail_without_existing_cache=False,
            )
            live = {
                "features": [],
                "sourceKind": "live",
                "sourceUrl": hms_cache.HMS_SERVICE,
                "sourceUpdatedAt": "2026-07-27T13:51:46Z",
                "analysisDate": "2026-07-27",
            }
            archive = {
                "features": [archive_feature],
                "sourceKind": "archive",
                "sourceUrl": hms_cache.archive_url(now.date() - hms_cache.dt.timedelta(days=1)),
                "sourceUpdatedAt": "2026-07-27T10:05:28Z",
                "analysisDate": "2026-07-26",
            }
            with mock.patch.object(
                hms_cache,
                "fetch_live_source",
                return_value=live,
            ), mock.patch.object(
                hms_cache,
                "fetch_archive_source",
                return_value=archive,
            ):
                hms_cache.build_cache(args, now=now)

            manifest = json.loads(
                (output / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["sourceKind"], "archive")
            self.assertEqual(manifest["analysisDate"], "2026-07-26")
            self.assertEqual(manifest["observedEnd"], "2026-07-26T15:00:00Z")
            self.assertEqual(manifest["polygonCount"], 1)
            asset_content = (output / manifest["asset"]["path"]).read_bytes()
            self.assertEqual(
                hashlib.sha256(asset_content).hexdigest(),
                manifest["asset"]["sha256"],
            )
            payload = json.loads(asset_content)
            self.assertEqual(payload["features"], [archive_feature])

    def test_nonempty_live_layer_wins_over_archive(self) -> None:
        now = hms_cache.dt.datetime(2026, 7, 27, 20, 0, tzinfo=hms_cache.UTC)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            args = SimpleNamespace(
                output=output,
                retries=1,
                archive_lookback_days=14,
                fail_without_existing_cache=False,
            )
            live = {
                "features": [self.feature(start="2026208 1600", end="2026208 1900")],
                "sourceKind": "live",
                "sourceUrl": hms_cache.HMS_SERVICE,
                "sourceUpdatedAt": "2026-07-27T19:10:00Z",
                "analysisDate": "2026-07-27",
            }
            with mock.patch.object(
                hms_cache,
                "fetch_live_source",
                return_value=live,
            ), mock.patch.object(
                hms_cache,
                "fetch_archive_source",
            ) as archive_fetch:
                hms_cache.build_cache(args, now=now)
            archive_fetch.assert_not_called()
            manifest = json.loads(
                (output / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["sourceKind"], "live")
            self.assertEqual(manifest["analysisDate"], "2026-07-27")
            self.assertEqual(manifest["observedEnd"], "2026-07-27T19:00:00Z")

    def test_failed_refresh_retains_only_a_complete_prior_cache(self) -> None:
        now = hms_cache.dt.datetime(2026, 7, 27, 20, 0, tzinfo=hms_cache.UTC)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            args = SimpleNamespace(
                output=output,
                retries=1,
                archive_lookback_days=14,
                fail_without_existing_cache=False,
            )
            live = {
                "features": [self.feature()],
                "sourceKind": "live",
                "sourceUrl": hms_cache.HMS_SERVICE,
                "sourceUpdatedAt": "2026-07-27T19:10:00Z",
                "analysisDate": "2026-07-27",
            }
            with mock.patch.object(
                hms_cache,
                "fetch_live_source",
                return_value=live,
            ):
                hms_cache.build_cache(args, now=now)
            manifest_path = output / "manifest.json"
            manifest_bytes = manifest_path.read_bytes()
            manifest = json.loads(manifest_bytes)

            failure = RuntimeError("temporary HMS failure")
            argv = ["build_hms_cache.py", "--output", str(output)]
            with mock.patch.object(
                hms_cache,
                "fetch_live_source",
                side_effect=failure,
            ), mock.patch.object(
                hms_cache,
                "fetch_archive_source",
                side_effect=failure,
            ), mock.patch.object(hms_cache.sys, "argv", argv):
                self.assertEqual(hms_cache.main(), 0)
            self.assertEqual(manifest_path.read_bytes(), manifest_bytes)

            (output / manifest["asset"]["path"]).write_bytes(b"corrupt")
            with mock.patch.object(
                hms_cache,
                "fetch_live_source",
                side_effect=failure,
            ), mock.patch.object(
                hms_cache,
                "fetch_archive_source",
                side_effect=failure,
            ), mock.patch.object(hms_cache.sys, "argv", argv):
                self.assertEqual(hms_cache.main(), 1)


if __name__ == "__main__":
    unittest.main()
