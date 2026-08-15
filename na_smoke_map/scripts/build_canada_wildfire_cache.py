#!/usr/bin/env python3
"""Build an atomic, browser-ready CWFIS/CIFFC Canadian wildfire cache."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


UTC = dt.timezone.utc
CWFIS_WFS = "https://geoserver.cwfif.nrcan.gc.ca/geoserver/public/wfs"
CWFIS_LAYER = "public:cwfif_national_reportedfires"
CIFFC_SITREP = "https://api.ciffc.net/v1/sitrep"
BC_CURRENT_FIRES = (
    "https://delivery.maps.gov.bc.ca/arcgis/rest/services/"
    "mpcm/bcgwpub/MapServer/502/query"
)
PAGE_SIZE = 5000
MAXIMUM_PAGES = 100
BC_PAGE_SIZE = 1000
BC_MAXIMUM_PAGES = 20
FIELDS = (
    "id,agency_code,region_code,national_fire_id,agency_fire_id,"
    "national_fire_cause,fire_type_ics,severity_nearest_dsr,"
    "fire_was_prescribed,percent_contained,fire_size,response_type,"
    "stage_of_control_status,situation_report_date,status_date,latitude,"
    "longitude,fire_year,status_year,record_start,record_end,geometry"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument(
        "--fail-without-existing-cache",
        action="store_true",
        help="Fail instead of retaining an already-published complete cache.",
    )
    args = parser.parse_args()
    if args.retries < 1:
        parser.error("retries must be positive")
    return args


def iso_time(value: dt.datetime | None = None) -> str:
    return (value or dt.datetime.now(UTC)).astimezone(UTC).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def request_json(
    url: str,
    parameters: dict[str, Any] | None,
    retries: int,
) -> dict[str, Any]:
    query_url = url
    if parameters:
        query_url = f"{url}?{urllib.parse.urlencode(parameters)}"
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(
            query_url,
            headers={
                "Accept": "application/json",
                "User-Agent": "na-smoke-map-cache/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise ValueError("JSON response is not an object")
            return payload
        except (
            OSError,
            ValueError,
            urllib.error.HTTPError,
            urllib.error.URLError,
        ) as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep((0.5, 1.5, 3.0)[min(attempt, 2)])
    raise RuntimeError(f"Canadian wildfire request failed: {last_error}") from last_error


def fetch_reported_fires(
    retries: int,
    generated: dt.datetime,
) -> tuple[list[dict[str, Any]], str | None]:
    timestamp = iso_time(generated)
    temporal_filter = (
        f"record_start <= {timestamp} AND record_end >= {timestamp} AND "
        "(fire_was_prescribed IS NULL OR fire_was_prescribed <> 1)"
    )
    features: list[dict[str, Any]] = []
    offset = 0
    source_timestamp: str | None = None
    for page_index in range(MAXIMUM_PAGES):
        payload = request_json(
            CWFIS_WFS,
            {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeNames": CWFIS_LAYER,
                "outputFormat": "application/json",
                "srsName": "EPSG:4326",
                "propertyName": FIELDS,
                "CQL_FILTER": temporal_filter,
                "sortBy": "id A",
                "startIndex": offset,
                "count": PAGE_SIZE,
            },
            retries,
        )
        page = payload.get("features")
        if not isinstance(page, list):
            raise ValueError("CWFIS response has no feature page")
        if page_index == 0:
            source_timestamp = payload.get("timeStamp")
        features.extend(page)
        returned = int(payload.get("numberReturned", len(page)))
        matched = payload.get("numberMatched")
        if matched != "unknown":
            try:
                if len(features) >= int(matched):
                    return features, source_timestamp
            except (TypeError, ValueError):
                pass
        if returned < PAGE_SIZE:
            return features, source_timestamp
        if not page:
            raise RuntimeError("CWFIS pagination stopped early")
        offset += len(page)
    raise RuntimeError("CWFIS pagination limit exceeded")


def normalize_fire_token(value: Any) -> str:
    token = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).lower()
    return re.sub(r"^20\d{2}", "", token)


def useful_official_name(value: Any) -> str | None:
    """Return a nonblank provincial INCIDENT_NAME without interpreting its value."""
    name = str(value or "").strip()
    return name or None


def bc_name_overrides(
    features: list[dict[str, Any]],
) -> tuple[dict[str, str], dict[str, int]]:
    """Index unambiguous BC official names by normalized provincial fire number."""
    candidates: dict[str, set[str]] = {}
    usable_name_count = 0
    for feature in features:
        properties = feature.get("attributes") or feature.get("properties") or {}
        fire_number = properties.get("FIRE_NUMBER")
        token = normalize_fire_token(fire_number)
        name = useful_official_name(properties.get("INCIDENT_NAME"))
        if not token or not name:
            continue
        usable_name_count += 1
        candidates.setdefault(token, set()).add(name)
    overrides = {
        token: next(iter(names))
        for token, names in candidates.items()
        if len(names) == 1
    }
    return overrides, {
        "reportedFireCount": len(features),
        "usableNameCount": usable_name_count,
        "ambiguousFireIdCount": sum(1 for names in candidates.values() if len(names) > 1),
    }


def fetch_bc_name_overrides(retries: int) -> tuple[dict[str, str], dict[str, int]]:
    """Fetch BC's current-season catalogue for exact display-name enrichment."""
    features: list[dict[str, Any]] = []
    offset = 0
    for _page_index in range(BC_MAXIMUM_PAGES):
        payload = request_json(
            BC_CURRENT_FIRES,
            {
                "where": "1=1",
                "outFields": "FIRE_NUMBER,INCIDENT_NAME",
                "returnGeometry": "false",
                "orderByFields": "FIRE_NUMBER ASC",
                "resultOffset": offset,
                "resultRecordCount": BC_PAGE_SIZE,
                "f": "json",
            },
            retries,
        )
        page = payload.get("features")
        if not isinstance(page, list):
            raise ValueError("BC current fires response has no feature page")
        features.extend(page)
        if not payload.get("exceededTransferLimit"):
            return bc_name_overrides(features)
        if not page:
            raise RuntimeError("BC current fires pagination stopped early")
        offset += len(page)
    raise RuntimeError("BC current fires pagination limit exceeded")


def priority_fire_references(value: Any) -> list[tuple[str, str]]:
    text = str(value or "").strip()
    raw_tokens = re.findall(r"[A-Za-z]+\d{3,8}", text)
    references: dict[str, str] = {}
    for raw_token in raw_tokens:
        token = normalize_fire_token(raw_token)
        if token and token not in references:
            references[token] = raw_token
    return list(references.items())


def priority_tokens(value: Any) -> list[str]:
    return [token for token, _display in priority_fire_references(value)]


def valid_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def distance_squared(
    left_lat: float,
    left_lon: float,
    right_lat: float,
    right_lon: float,
) -> float:
    longitude_scale = math.cos(math.radians((left_lat + right_lat) / 2))
    return (left_lat - right_lat) ** 2 + (
        (left_lon - right_lon) * longitude_scale
    ) ** 2


def priority_rows(sitrep: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    agencies = sitrep.get("agencies_sitereps") or {}
    if not isinstance(agencies, dict):
        raise ValueError("CIFFC situation report has no agency reports")
    for agency, report in agencies.items():
        for priority in (report or {}).get("priority_fires") or []:
            if not isinstance(priority, dict):
                continue
            rows.append({**priority, "agency_code": str(agency).upper()})
    return rows


def match_priorities(
    features: list[dict[str, Any]],
    priorities: list[dict[str, Any]],
    report_date: str | None,
) -> tuple[
    dict[str, dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
]:
    by_agency: dict[str, list[dict[str, Any]]] = {}
    by_token: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for feature in features:
        properties = feature.get("properties") or {}
        agency = str(properties.get("agency_code") or "").upper()
        by_agency.setdefault(agency, []).append(feature)
        token = normalize_fire_token(properties.get("agency_fire_id"))
        if token:
            by_token.setdefault((agency, token), []).append(feature)

    matched: dict[str, dict[str, Any]] = {}
    unmatched_rows: list[dict[str, Any]] = []
    priority_references: dict[tuple[str, str], dict[str, str]] = {}
    matched_references: set[tuple[str, str]] = set()
    for priority in priorities:
        agency = priority["agency_code"]
        source_label = str(priority.get("field_fire_id") or "").strip()
        references = priority_fire_references(priority.get("field_fire_id"))
        tokens = [token for token, _display in references]
        coverage_references = references or [
            (f"label:{normalize_fire_token(source_label)}", None)
        ]
        for reference, display in coverage_references:
            priority_references.setdefault(
                (agency, reference),
                {
                    "agencyCode": agency,
                    "fireId": display,
                    "sourceLabel": source_label,
                },
            )
        candidates: list[dict[str, Any]] = []
        for token in tokens:
            token_candidates = by_token.get((agency, token), [])
            if not token_candidates:
                token_candidates = [
                    feature
                    for feature in by_agency.get(agency, [])
                    if normalize_fire_token(
                        (feature.get("properties") or {}).get("agency_fire_id")
                    ).endswith(token)
                ]
            token_candidates = [
                feature for feature in token_candidates
                if (feature.get("properties") or {}).get("national_fire_id")
            ]
            if token_candidates:
                matched_references.add((agency, token))
            for feature in token_candidates:
                if feature not in candidates:
                    candidates.append(feature)
        if not candidates:
            latitude = valid_number(priority.get("field_latitude"))
            longitude = valid_number(priority.get("field_longitude"))
            if latitude is not None and longitude is not None:
                nearby = []
                for feature in by_agency.get(agency, []):
                    properties = feature.get("properties") or {}
                    if not properties.get("national_fire_id"):
                        continue
                    fire_lat = valid_number(properties.get("latitude"))
                    fire_lon = valid_number(properties.get("longitude"))
                    if fire_lat is None or fire_lon is None:
                        continue
                    distance = distance_squared(latitude, longitude, fire_lat, fire_lon)
                    if distance <= 0.05 ** 2:
                        nearby.append((distance, feature))
                nearby.sort(key=lambda item: item[0])
                candidates = [nearby[0][1]] if nearby else []
                if candidates:
                    for reference, _display in coverage_references:
                        matched_references.add((agency, reference))
        if not candidates:
            unmatched_rows.append(priority)
            continue
        for feature in candidates:
            identifier = str((feature.get("properties") or {}).get("national_fire_id") or "")
            if not identifier:
                continue
            matched[identifier] = {
                "reportDate": report_date,
                "fireId": priority.get("field_fire_id"),
                "stage": priority.get("field_stage_of_control"),
                "sizeHa": valid_number(priority.get("field_size")),
                "incidentType": priority.get("field_incident_type"),
            }
    unmatched_fires = [
        details
        for reference, details in priority_references.items()
        if reference not in matched_references
    ]
    coverage = {
        "priorityFireCount": len(priority_references),
        "matchedPriorityFireCount": len(matched_references),
        "unmatchedPriorityFireCount": len(unmatched_fires),
        "unmatchedPriorityFires": unmatched_fires,
    }
    return matched, unmatched_rows, coverage


def fire_sort_key(record: dict[str, Any]) -> tuple[float, str]:
    properties = record["p"]["properties"]
    timestamp = properties.get("status_date") or properties.get("situation_report_date")
    try:
        parsed = dt.datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
        numeric = parsed.timestamp()
    except (TypeError, ValueError):
        numeric = 0
    return (-numeric, record["i"])


def wire_records(
    features: list[dict[str, Any]],
    priorities: dict[str, dict[str, Any]],
    provincial_names: dict[str, dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    provincial_names = provincial_names or {}
    records: list[dict[str, Any]] = []
    for feature in features:
        properties = feature.get("properties") or {}
        identifier = str(
            properties.get("national_fire_id")
            or f"{properties.get('agency_code', 'CA')}:{properties.get('id', 'unknown')}"
        )
        geometry = feature.get("geometry")
        if not geometry:
            latitude = valid_number(properties.get("latitude"))
            longitude = valid_number(properties.get("longitude"))
            if latitude is not None and longitude is not None:
                geometry = {"type": "Point", "coordinates": [longitude, latitude]}
        point = {
            "type": "Feature",
            "geometry": geometry,
            "properties": properties,
        }
        priority = priorities.get(identifier)
        agency = str(properties.get("agency_code") or "").upper()
        provincial_name = provincial_names.get(agency, {}).get(
            normalize_fire_token(properties.get("agency_fire_id"))
        )
        context = {"priority": priority} if priority else {}
        if provincial_name:
            context.update({
                "name": provincial_name,
                "nameSource": f"{agency} Wildfire Service",
            })
        records.append({
            "i": identifier,
            "s": "canada",
            "a": properties.get("stage_of_control_status") != "EX",
            "p": point,
            "g": [],
            "m": [],
            "c": context,
        })
    records.sort(key=fire_sort_key)
    return records


def serialize(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def write_asset(output: Path, stem: str, payload: dict[str, Any]) -> dict[str, Any]:
    content = serialize(payload)
    digest = hashlib.sha256(content).hexdigest()
    filename = f"{stem}.{digest[:16]}.json"
    temporary = output / f"{filename}.tmp"
    temporary.write_bytes(content)
    os.replace(temporary, output / filename)
    return {"path": filename, "sha256": digest, "bytes": len(content)}


def existing_cache_is_complete(output: Path) -> bool:
    try:
        manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("schemaVersion") != 1:
            return False
        for name in ("default", "catalog"):
            descriptor = manifest[name]
            content = (output / descriptor["path"]).read_bytes()
            if len(content) != int(descriptor["bytes"]):
                return False
            if hashlib.sha256(content).hexdigest() != descriptor["sha256"]:
                return False
        return True
    except (OSError, TypeError, ValueError, KeyError):
        return False


def build_cache(args: argparse.Namespace, now: dt.datetime | None = None) -> None:
    generated = (now or dt.datetime.now(UTC)).astimezone(UTC)
    args.output.mkdir(parents=True, exist_ok=True)
    features, source_timestamp = fetch_reported_fires(args.retries, generated)
    sitrep = request_json(CIFFC_SITREP, None, args.retries)
    bc_name_status = "available"
    try:
        bc_names, bc_name_coverage = fetch_bc_name_overrides(args.retries)
    except Exception as exc:
        # CWFIS/CIFFC still form a complete Canadian catalog. Do not let an
        # optional provincial display-name source freeze that catalog at an old
        # generation; publish without BC names and retry on the next hour.
        print(
            "BC wildfire name enrichment unavailable; publishing without BC names: "
            f"{exc}",
            file=sys.stderr,
        )
        bc_names = {}
        bc_name_coverage = {
            "reportedFireCount": 0,
            "usableNameCount": 0,
            "ambiguousFireIdCount": 0,
        }
        bc_name_status = "unavailable"
    priorities = priority_rows(sitrep)
    matched, unmatched_rows, priority_coverage = match_priorities(
        features,
        priorities,
        sitrep.get("field_date"),
    )
    records = wire_records(features, matched, {"BC": bc_names})
    default_records = [record for record in records if record.get("c", {}).get("priority")]

    generated_at = iso_time(generated)
    common = {"schemaVersion": 1, "generatedAt": generated_at}
    default_asset = write_asset(
        args.output,
        "default",
        {**common, "records": default_records},
    )
    catalog_asset = write_asset(
        args.output,
        "catalog",
        {**common, "records": records},
    )
    manifest = {
        **common,
        "refreshIntervalMinutes": 60,
        "source": "NRCan CWFIS Agency Reported Wildfires",
        "sourceTimestamp": source_timestamp,
        "prioritySource": "CIFFC Situation Report Priority Fires",
        "nameSources": {
            "BC": {
                "source": "BC Wildfire Service Fire Locations - Current",
                "status": bc_name_status,
                "reportedFireCount": bc_name_coverage["reportedFireCount"],
                "usableNameCount": bc_name_coverage["usableNameCount"],
                "matchedNameCount": sum(
                    1
                    for record in records
                    if record.get("c", {}).get("nameSource") == "BC Wildfire Service"
                ),
                "ambiguousFireIdCount": bc_name_coverage["ambiguousFireIdCount"],
            }
        },
        "priorityReportDate": sitrep.get("field_date"),
        "defaultCount": len(default_records),
        "catalogCount": len(records),
        "priorityCount": len(priorities),
        "matchedPriorityCount": len(priorities) - len(unmatched_rows),
        "unmatchedPriorityCount": len(unmatched_rows),
        **priority_coverage,
        "activeCount": sum(1 for record in records if record["a"]),
        "default": default_asset,
        "catalog": catalog_asset,
    }
    temporary_manifest = args.output / "manifest.json.tmp"
    temporary_manifest.write_bytes(serialize(manifest))
    os.replace(temporary_manifest, args.output / "manifest.json")

    retained = {"manifest.json", default_asset["path"], catalog_asset["path"]}
    for candidate in args.output.glob("*.json"):
        if candidate.name not in retained:
            candidate.unlink(missing_ok=True)
    print(
        "Canadian wildfire cache ready: "
        f"{len(default_records)} priority / {len(records)} catalog records; "
        f"{priority_coverage['matchedPriorityFireCount']}/"
        f"{priority_coverage['priorityFireCount']} priority fires matched; "
        f"{priority_coverage['unmatchedPriorityFireCount']} unmatched",
        flush=True,
    )


def main() -> int:
    args = parse_args()
    try:
        build_cache(args)
    except Exception as exc:
        if not args.fail_without_existing_cache and existing_cache_is_complete(args.output):
            print(
                "Canadian wildfire cache refresh failed; retaining complete prior cache: "
                f"{exc}",
                file=sys.stderr,
            )
            return 0
        print(f"Canadian wildfire cache build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
