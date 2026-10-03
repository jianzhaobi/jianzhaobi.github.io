#!/usr/bin/env python3
"""Regression checks for the single-file smoke map and cache timeline."""

from __future__ import annotations

import hashlib
import json
import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import build_hms_cache as hms_cache
import build_canada_wildfire_cache as canada_wildfire_cache
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


class PublicSmokeMapContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = INDEX_PATH.read_text(encoding="utf-8")
        cls.workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    def test_shell_loads_versioned_release_assets(self) -> None:
        self.assertIn('<link rel="stylesheet" href="./style.css?v=', self.index)
        self.assertIn('<script src="./app.js?v=', self.index)
        self.assertIn('maplibre-gl@5.16.0/dist/maplibre-gl.js', self.index)
        self.assertIn('maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js', self.index)
        self.assertIn('<option value="column" selected>Entire atmosphere</option>', self.index)
        self.assertNotIn('function initializeWildfireCache', self.index)
        versions = re.findall(r'(?:style\.css|app\.js)\?v=([^"\s]+)', self.index)
        self.assertEqual(len(versions), 2)
        self.assertEqual(versions[0], versions[1])
        for dependency in ('maplibre-gl@5.16.0/dist/maplibre-gl.css',
                           'maplibre-gl@5.16.0/dist/maplibre-gl.js',
                           'maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js'):
            tag = next(tag for tag in re.findall(r'<(?:script|link)\b[^>]+>', self.index, re.S)
                       if dependency in tag)
            self.assertIn('integrity="sha384-', tag)
            self.assertIn('crossorigin="anonymous"', tag)
        self.assertTrue((PROJECT_ROOT / 'app.js').is_file())
        self.assertTrue((PROJECT_ROOT / 'style.css').is_file())
        self.assertFalse((PROJECT_ROOT / 'app.js.map').exists())
        self.assertNotIn('sourceMappingURL', (PROJECT_ROOT / 'app.js').read_text(encoding='utf-8'))

    def test_referrer_and_csp_allow_only_needed_basemap_connections(self) -> None:
        self.assertIn('<meta name="referrer" content="origin">', self.index)
        csp = self.index.split('http-equiv="Content-Security-Policy"', 1)[1].split('>', 1)[0]
        self.assertIn("script-src 'self' https://unpkg.com", csp)
        self.assertIn("connect-src 'self' https://basemaps.cartocdn.com", csp)
        self.assertNotIn("services2.arcgis.com", csp)
        self.assertNotIn("services3.arcgis.com", csp)

    def test_cache_builders_and_runtime_allowlist_remain_public(self) -> None:
        for name in ("build_wildfire_cache.py", "build_canada_wildfire_cache.py", "build_hms_cache.py", "build_static_cache.py"):
            self.assertIn(f"scripts/{name}", self.workflow)
        self.assertIn('cp na_smoke_map/index.html na_smoke_map/style.css na_smoke_map/app.js na_smoke_map/site.webmanifest', self.workflow)
        self.assertIn('rsync -a na_smoke_map/cache/', self.workflow)
        self.assertNotIn('cp na_smoke_map/scripts/', self.workflow)


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


class CanadianWildfireCacheBuilderTests(unittest.TestCase):
    @staticmethod
    def feature(
        identifier: str,
        agency_fire_id: str,
        stage: str = "OC",
        size: float = 10,
    ) -> dict:
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-121, 51]},
            "properties": {
                "id": len(identifier),
                "agency_code": "BC",
                "region_code": "C4",
                "national_fire_id": identifier,
                "agency_fire_id": agency_fire_id,
                "national_fire_cause": "N",
                "fire_was_prescribed": 0,
                "percent_contained": -1,
                "fire_size": size,
                "response_type": "FUL",
                "stage_of_control_status": stage,
                "situation_report_date": "2026-08-04T12:00:00Z",
                "status_date": "2026-08-04T16:00:00Z",
                "latitude": 51,
                "longitude": -121,
                "record_start": "2026-08-04T00:00:00Z",
                "record_end": "2026-12-31T23:59:59Z",
            },
        }

    def test_builds_priority_default_from_one_reported_catalog(self) -> None:
        features = [
            self.feature("2026_BC_2026-C40983", "2026-C40983"),
            self.feature("2026_BC_2026-V10000", "2026-V10000", "EX"),
        ]
        sitrep = {
            "field_date": "2026-08-04",
            "agencies_sitereps": {
                "BC": {
                    "priority_fires": [{
                        "field_fire_id": "Pear Lake (C40983)",
                        "field_stage_of_control": "OC",
                        "field_size": "115250",
                        "field_latitude": "50.979",
                        "field_longitude": "-121.08",
                        "field_incident_type": None,
                    }]
                }
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            args = SimpleNamespace(
                output=output,
                retries=1,
                fail_without_existing_cache=False,
            )
            with mock.patch.object(
                canada_wildfire_cache,
                "fetch_reported_fires",
                return_value=(features, "2026-08-05T13:45:00Z"),
            ), mock.patch.object(
                canada_wildfire_cache,
                "fetch_bc_name_overrides",
                return_value=({}, {
                    "reportedFireCount": 0,
                    "usableNameCount": 0,
                    "ambiguousFireIdCount": 0,
                }),
            ), mock.patch.object(
                canada_wildfire_cache,
                "request_json",
                return_value=sitrep,
            ):
                canada_wildfire_cache.build_cache(args)

            manifest = json.loads(
                (output / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["catalogCount"], 2)
            self.assertEqual(manifest["defaultCount"], 1)
            self.assertEqual(manifest["activeCount"], 1)
            self.assertEqual(manifest["matchedPriorityCount"], 1)
            self.assertEqual(manifest["priorityFireCount"], 1)
            self.assertEqual(manifest["matchedPriorityFireCount"], 1)
            self.assertEqual(manifest["unmatchedPriorityFireCount"], 0)
            self.assertEqual(manifest["unmatchedPriorityFires"], [])
            default = json.loads(
                (output / manifest["default"]["path"]).read_text(encoding="utf-8")
            )
            self.assertNotIn("name", default["records"][0]["c"]["priority"])
            self.assertEqual(default["records"][0]["i"], "2026_BC_2026-C40983")

    def test_audits_each_fire_id_inside_a_grouped_priority_row(self) -> None:
        features = [
            self.feature("2026_BC_2026-K51402", "2026-K51402"),
        ]
        priorities = [{
            "agency_code": "BC",
            "field_fire_id": "Bradley Creek (K41315) (Quilpituk Creek K51402)",
            "field_stage_of_control": "OC",
            "field_size": "742",
            "field_latitude": "51",
            "field_longitude": "-121",
            "field_incident_type": None,
        }]

        matched, unmatched_rows, coverage = canada_wildfire_cache.match_priorities(
            features,
            priorities,
            "2026-08-04",
        )

        self.assertEqual(set(matched), {"2026_BC_2026-K51402"})
        self.assertEqual(unmatched_rows, [])
        self.assertEqual(coverage["priorityFireCount"], 2)
        self.assertEqual(coverage["matchedPriorityFireCount"], 1)
        self.assertEqual(coverage["unmatchedPriorityFireCount"], 1)
        self.assertEqual(coverage["unmatchedPriorityFires"], [{
            "agencyCode": "BC",
            "fireId": "K41315",
            "sourceLabel": "Bradley Creek (K41315) (Quilpituk Creek K51402)",
        }])

    def test_plain_priority_name_uses_coordinate_match_without_becoming_display_name(self) -> None:
        features = [
            self.feature("2026_BC_2026-V10755", "2026-V10755"),
        ]
        priorities = [{
            "agency_code": "BC",
            "field_fire_id": "Ainslie Creek",
            "field_stage_of_control": "OC",
            "field_size": "40599",
            "field_latitude": "51",
            "field_longitude": "-121",
            "field_incident_type": None,
        }]

        matched, unmatched_rows, coverage = canada_wildfire_cache.match_priorities(
            features,
            priorities,
            "2026-08-05",
        )
        records = canada_wildfire_cache.wire_records(features, matched)

        self.assertEqual(unmatched_rows, [])
        self.assertEqual(coverage["priorityFireCount"], 1)
        self.assertEqual(coverage["matchedPriorityFireCount"], 1)
        self.assertEqual(coverage["unmatchedPriorityFires"], [])
        self.assertNotIn("name", records[0]["c"]["priority"])

    def test_bc_incident_names_are_exact_id_enrichment_only(self) -> None:
        overrides, coverage = canada_wildfire_cache.bc_name_overrides([
            {"attributes": {"FIRE_NUMBER": "C40983", "INCIDENT_NAME": "Pear Lake"}},
            {"attributes": {"FIRE_NUMBER": "K21635", "INCIDENT_NAME": "K21635"}},
            {"attributes": {"FIRE_NUMBER": "V10755", "INCIDENT_NAME": "Ainslie Creek"}},
        ])
        records = canada_wildfire_cache.wire_records([
            self.feature("2026_BC_2026-C40983", "2026-C40983"),
            self.feature("2026_BC_2026-K21635", "2026-K21635"),
        ], {}, {"BC": overrides})

        by_id = {record["i"]: record for record in records}
        self.assertEqual(by_id["2026_BC_2026-C40983"]["c"]["name"], "Pear Lake")
        self.assertEqual(
            by_id["2026_BC_2026-C40983"]["c"]["nameSource"],
            "BC Wildfire Service",
        )
        self.assertEqual(by_id["2026_BC_2026-K21635"]["c"]["name"], "K21635")
        self.assertEqual(coverage["reportedFireCount"], 3)
        self.assertEqual(coverage["usableNameCount"], 3)

    def test_bc_enrichment_failure_does_not_retain_the_whole_catalog(self) -> None:
        features = [self.feature("2026_BC_2026-C40983", "2026-C40983")]
        sitrep = {"field_date": "2026-08-04", "agencies_sitereps": {}}
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(
                output=Path(directory), retries=1, fail_without_existing_cache=False,
            )
            with mock.patch.object(
                canada_wildfire_cache, "fetch_reported_fires",
                return_value=(features, "2026-08-05T13:45:00Z"),
            ), mock.patch.object(
                canada_wildfire_cache, "fetch_bc_name_overrides",
                side_effect=RuntimeError("BC unavailable"),
            ), mock.patch.object(
                canada_wildfire_cache, "request_json", return_value=sitrep,
            ):
                canada_wildfire_cache.build_cache(args)

            manifest = json.loads((Path(directory) / "manifest.json").read_text())
            self.assertEqual(manifest["catalogCount"], 1)
            self.assertEqual(manifest["nameSources"]["BC"]["status"], "unavailable")
            catalog = json.loads(
                (Path(directory) / manifest["catalog"]["path"]).read_text()
            )
            self.assertNotIn("name", catalog["records"][0]["c"])

    def test_unmatched_plain_priority_name_is_not_reported_as_a_fire_id(self) -> None:
        priorities = [{
            "agency_code": "BC",
            "field_fire_id": "Pear Lake",
            "field_latitude": "50.979",
            "field_longitude": "-121.08",
        }]

        matched, unmatched_rows, coverage = canada_wildfire_cache.match_priorities(
            [],
            priorities,
            "2026-08-05",
        )

        self.assertEqual(matched, {})
        self.assertEqual(unmatched_rows, priorities)
        self.assertEqual(coverage["unmatchedPriorityFires"], [{
            "agencyCode": "BC",
            "fireId": None,
            "sourceLabel": "Pear Lake",
        }])

    def test_active_is_derived_from_non_extinguished_reported_records(self) -> None:
        records = canada_wildfire_cache.wire_records([
            self.feature("oc", "1", "OC"),
            self.feature("bh", "2", "BH"),
            self.feature("uc", "3", "UC"),
            self.feature("ex", "4", "EX"),
        ], {})
        self.assertEqual({record["i"] for record in records if record["a"]}, {"oc", "bh", "uc"})

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
