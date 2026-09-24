#!/usr/bin/env python3
"""Build an atomic, browser-ready hourly WFIGS wildfire cache."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any


UTC = dt.timezone.utc
WFIGS_ROOT = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services"
)
SERVICES = {
    "currentLocations": (
        f"{WFIGS_ROOT}/WFIGS_Incident_Locations_Current/FeatureServer/0"
    ),
    "currentPerimeters": (
        f"{WFIGS_ROOT}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0"
    ),
    "ytdLocations": (
        f"{WFIGS_ROOT}/WFIGS_Incident_Locations_YearToDate/FeatureServer/0"
    ),
    "ytdPerimeters": (
        f"{WFIGS_ROOT}/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0"
    ),
}
POINT_FIELDS = ",".join(
    (
        "OBJECTID",
        "IrwinID",
        "IncidentName",
        "FireDiscoveryDateTime",
        "IncidentSize",
        "PercentContained",
        "ContainmentDateTime",
        "ControlDateTime",
        "FireOutDateTime",
        "FireCause",
        "POOCounty",
        "POOState",
        "InitialLatitude",
        "InitialLongitude",
        "ModifiedOnDateTime_dt",
        "IncidentTypeCategory",
        "ICS209ReportStatus",
        "ICS209ReportDateTime",
        "IsCpxChild",
        "CpxName",
        "CpxID",
    )
)
PERIMETER_FIELDS = ",".join(
    (
        "OBJECTID",
        "attr_IrwinID",
        "attr_IncidentName",
        "attr_FireDiscoveryDateTime",
        "attr_IncidentSize",
        "attr_PercentContained",
        "attr_ContainmentDateTime",
        "attr_ControlDateTime",
        "attr_FireOutDateTime",
        "attr_ModifiedOnDateTime_dt",
        "attr_IncidentTypeCategory",
        "poly_GISAcres",
        "poly_PolygonDateTime",
    )
)
POINT_WHERE = "IncidentTypeCategory IN ('WF','CX')"
PERIMETER_WHERE = "attr_IncidentTypeCategory IN ('WF','CX')"
PAGE_SIZE = 2000
MAXIMUM_PAGES = 100


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument(
        "--fail-without-existing-cache",
        action="store_true",
        help="Fail instead of retaining an already-published complete cache.",
    )
    args = parser.parse_args()
    if args.retries < 1 or args.jobs < 1 or args.jobs > 2:
        parser.error("retries must be positive and jobs must be 1 or 2")
    return args


def iso_time(value: dt.datetime | None = None) -> str:
    return (value or dt.datetime.now(UTC)).astimezone(UTC).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def normalize_irwin_id(value: Any) -> str:
    return str(value or "").strip().strip("{}").lower()


def object_id(feature: dict[str, Any]) -> int | None:
    value = feature.get("properties", {}).get("OBJECTID")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def feature_id(feature: dict[str, Any], source: str) -> str:
    properties = feature.get("properties", {})
    normalized = normalize_irwin_id(
        properties.get("IrwinID") or properties.get("attr_IrwinID")
    )
    if normalized:
        return normalized
    return f"{source}:{properties.get('OBJECTID') or properties.get('IncidentName') or 'unknown'}"


def request_json(
    url: str,
    parameters: dict[str, Any],
    retries: int,
) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(
        {
            name: value
            for name, value in parameters.items()
            if value is not None and value != ""
        }
    ).encode("utf-8")
    query_url = f"{url}?{encoded.decode('utf-8')}"
    use_post = len(query_url) > 1800
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(
            url if use_post else query_url,
            data=encoded if use_post else None,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": "na-smoke-map-cache/1.0",
            },
            method="POST" if use_post else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=75) as response:
                payload = json.load(response)
            if payload.get("error"):
                error = payload["error"]
                raised = RuntimeError(
                    f"ArcGIS {error.get('code')}: {error.get('message')}"
                )
                setattr(raised, "arcgis_code", error.get("code"))
                raise raised
            return payload
        except (
            OSError,
            ValueError,
            urllib.error.HTTPError,
            urllib.error.URLError,
            RuntimeError,
        ) as exc:
            last_error = exc
            code = getattr(exc, "code", None) or getattr(
                exc, "arcgis_code", None
            )
            if code == 429 and attempt < retries - 1:
                retry_after = 61
                if isinstance(exc, urllib.error.HTTPError):
                    try:
                        retry_after = max(
                            retry_after,
                            int(exc.headers.get("Retry-After", retry_after)),
                        )
                    except (TypeError, ValueError):
                        pass
                time.sleep(min(65, retry_after))
            elif attempt < retries - 1:
                time.sleep((0.5, 1.5, 3.0)[min(attempt, 2)])
    raise RuntimeError(f"WFIGS request failed: {last_error}") from last_error


def fetch_feature_pages(
    service: str,
    parameters: dict[str, Any],
    retries: int,
) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    offset = 0
    for page_index in range(MAXIMUM_PAGES):
        payload = request_json(
            f"{service}/query",
            {
                **parameters,
                "f": "geojson",
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
            },
            retries,
        )
        page = payload.get("features")
        if not isinstance(page, list):
            raise ValueError(f"ArcGIS response has no feature page: {service}")
        features.extend(page)
        exceeded = bool(payload.get("exceededTransferLimit"))
        if len(page) < PAGE_SIZE and not exceeded:
            return features
        if not page:
            raise RuntimeError(f"ArcGIS pagination stopped early: {service}")
        offset += len(page)
        if page_index == MAXIMUM_PAGES - 1:
            raise RuntimeError(f"ArcGIS pagination limit exceeded: {service}")
    return features


def fetch_source(
    name: str,
    service: str,
    retries: int,
) -> tuple[str, list[dict[str, Any]], int | None]:
    metadata = request_json(service, {"f": "json"}, retries)
    if name.endswith("Locations"):
        parameters = {
            "where": POINT_WHERE,
            "outFields": POINT_FIELDS,
            "returnGeometry": "true",
            "outSR": 4326,
            "orderByFields": "OBJECTID ASC",
        }
    else:
        parameters = {
            "where": PERIMETER_WHERE,
            "outFields": PERIMETER_FIELDS,
            "returnGeometry": "true",
            "outSR": 4326,
            "geometryPrecision": 5,
            "maxAllowableOffset": 0.0001,
            "orderByFields": "OBJECTID ASC",
        }
    features = fetch_feature_pages(service, parameters, retries)
    last_edit = metadata.get("editingInfo", {}).get("lastEditDate")
    return name, features, int(last_edit) if last_edit else None


def is_top_level(feature: dict[str, Any]) -> bool:
    properties = feature.get("properties", {})
    category = properties.get("IncidentTypeCategory")
    if category == "CX":
        return True
    if category != "WF":
        return False
    try:
        return int(properties.get("IsCpxChild") or 0) == 0
    except (TypeError, ValueError):
        return True


def is_member(feature: dict[str, Any]) -> bool:
    properties = feature.get("properties", {})
    if properties.get("IncidentTypeCategory") != "WF":
        return False
    try:
        return int(properties.get("IsCpxChild") or 0) == 1
    except (TypeError, ValueError):
        return False


def group_perimeters(
    features: list[dict[str, Any]],
    source: str,
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        properties = feature.get("properties", {})
        if properties.get("attr_IncidentTypeCategory") not in ("WF", "CX"):
            continue
        grouped[feature_id(feature, source)].append(feature)
    return grouped


def group_members(
    features: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        if not is_member(feature):
            continue
        parent_id = normalize_irwin_id(feature.get("properties", {}).get("CpxID"))
        if parent_id:
            grouped[parent_id].append(feature)
    return grouped


def wire_record(
    feature: dict[str, Any],
    source: str,
    active_ids: set[str],
    active_object_ids: set[int],
    perimeters: dict[str, list[dict[str, Any]]],
    members: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    identifier = feature_id(feature, source)
    oid = object_id(feature)
    active = identifier in active_ids or (
        oid is not None and oid in active_object_ids
    )
    raw_id = normalize_irwin_id(feature.get("properties", {}).get("IrwinID"))
    child_records = [
        wire_record(
            member,
            source,
            active_ids,
            active_object_ids,
            perimeters,
            {},
        )
        for member in members.get(raw_id, ())
    ]
    child_records.sort(key=record_sort_key)
    return {
        "i": identifier,
        "s": source,
        "a": active,
        "p": feature,
        "g": perimeters.get(identifier, []),
        "m": child_records,
    }


def perimeter_only_record(
    identifier: str,
    source: str,
    features: list[dict[str, Any]],
    active_ids: set[str],
    active_object_ids: set[int],
) -> dict[str, Any]:
    object_ids = {
        oid for feature in features if (oid := object_id(feature)) is not None
    }
    return {
        "i": identifier,
        "s": source,
        "a": identifier in active_ids or bool(object_ids & active_object_ids),
        "p": None,
        "g": features,
        "m": [],
    }


def valid_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def record_property(record: dict[str, Any], point_name: str, perimeter_name: str) -> Any:
    value = (record.get("p") or {}).get("properties", {}).get(point_name)
    if value not in (None, ""):
        return value
    for perimeter in record.get("g", ()):
        value = perimeter.get("properties", {}).get(perimeter_name)
        if value not in (None, ""):
            return value
    return None


def is_imsr(record: dict[str, Any]) -> bool:
    properties = (record.get("p") or {}).get("properties", {})
    contained = valid_number(
        record_property(record, "PercentContained", "attr_PercentContained")
    )
    return (
        properties.get("ICS209ReportStatus") in ("U", "I")
        and (contained is None or contained < 100)
        and not record_property(
            record, "ContainmentDateTime", "attr_ContainmentDateTime"
        )
        and not record_property(record, "ControlDateTime", "attr_ControlDateTime")
        and not record_property(record, "FireOutDateTime", "attr_FireOutDateTime")
    )


def record_sort_key(record: dict[str, Any]) -> tuple[float, float]:
    properties = (record.get("p") or {}).get("properties", {})
    discovery = valid_number(
        record_property(
            record,
            "FireDiscoveryDateTime",
            "attr_FireDiscoveryDateTime",
        )
    )
    oid = valid_number(properties.get("OBJECTID"))
    if oid is None:
        oid = max(
            (
                valid_number(feature.get("properties", {}).get("OBJECTID")) or 0
                for feature in record.get("g", ())
            ),
            default=0,
        )
    return (
        -(discovery if discovery is not None else float("-inf")),
        -(oid if oid is not None else 0),
    )


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
    return {
        "path": filename,
        "sha256": digest,
        "bytes": len(content),
    }


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


def build_cache(args: argparse.Namespace) -> None:
    args.output.mkdir(parents=True, exist_ok=True)
    fetched: dict[str, list[dict[str, Any]]] = {}
    edit_times: dict[str, int | None] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as executor:
        futures = {
            executor.submit(fetch_source, name, service, args.retries): name
            for name, service in SERVICES.items()
        }
        for future in concurrent.futures.as_completed(futures):
            name, features, last_edit = future.result()
            fetched[name] = features
            edit_times[name] = last_edit
            print(f"{name}: {len(features)} features", flush=True)

    current_locations = fetched["currentLocations"]
    ytd_locations = fetched["ytdLocations"]
    current_top = [feature for feature in current_locations if is_top_level(feature)]
    ytd_top = [feature for feature in ytd_locations if is_top_level(feature)]
    active_ids = {
        feature_id(feature, "current")
        for feature in (
            current_locations + fetched["currentPerimeters"]
        )
    }
    active_point_object_ids = {
        oid
        for feature in current_locations
        if (oid := object_id(feature)) is not None
    }
    active_perimeter_object_ids = {
        oid
        for feature in fetched["currentPerimeters"]
        if (oid := object_id(feature)) is not None
    }
    ytd_ids = {feature_id(feature, "ytd") for feature in ytd_top}
    ytd_object_ids = {
        oid for feature in ytd_top if (oid := object_id(feature)) is not None
    }
    current_only = [
        feature
        for feature in current_top
        if feature_id(feature, "current") not in ytd_ids
        and (
            object_id(feature) is None
            or object_id(feature) not in ytd_object_ids
        )
    ]

    perimeter_sets = {
        "ytd": group_perimeters(fetched["ytdPerimeters"], "ytd"),
        "current": group_perimeters(fetched["currentPerimeters"], "current"),
    }
    member_sets = {
        "ytd": group_members(ytd_locations),
        "current": group_members(current_locations),
    }
    records = [
        wire_record(
            feature,
            "ytd",
            active_ids,
            active_point_object_ids,
            perimeter_sets["ytd"],
            member_sets["ytd"],
        )
        for feature in ytd_top
    ]
    records.extend(
        wire_record(
            feature,
            "current",
            active_ids,
            active_point_object_ids,
            perimeter_sets["current"],
            member_sets["current"],
        )
        for feature in current_only
    )
    record_ids = {record["i"] for record in records}
    member_ids = {
        feature_id(feature, source)
        for source, features in (
            ("ytd", ytd_locations),
            ("current", current_locations),
        )
        for feature in features
        if is_member(feature)
    }
    for source in ("ytd", "current"):
        for identifier, features in perimeter_sets[source].items():
            if identifier in record_ids or identifier in member_ids:
                continue
            if not any(
                feature.get("properties", {}).get("attr_IncidentTypeCategory")
                == "WF"
                for feature in features
            ):
                continue
            records.append(
                perimeter_only_record(
                    identifier,
                    source,
                    features,
                    active_ids,
                    active_perimeter_object_ids,
                )
            )
            record_ids.add(identifier)
    records.sort(key=record_sort_key)
    default_records = [record for record in records if is_imsr(record)]

    generated_at = iso_time()
    common = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
    }
    default_asset = write_asset(
        args.output,
        "default",
        {
            **common,
            "records": default_records,
        },
    )
    catalog_asset = write_asset(
        args.output,
        "catalog",
        {
            **common,
            "records": records,
        },
    )
    manifest = {
        **common,
        "refreshIntervalMinutes": 60,
        "source": "NIFC WFIGS",
        "sourceEditTimes": edit_times,
        "defaultCount": len(default_records),
        "catalogCount": len(records),
        "default": default_asset,
        "catalog": catalog_asset,
    }
    temporary_manifest = args.output / "manifest.json.tmp"
    temporary_manifest.write_bytes(serialize(manifest))
    os.replace(temporary_manifest, args.output / "manifest.json")

    retained = {
        "manifest.json",
        default_asset["path"],
        catalog_asset["path"],
    }
    for candidate in args.output.glob("*.json"):
        if candidate.name not in retained:
            candidate.unlink(missing_ok=True)
    print(
        "wildfire cache ready: "
        f"{len(default_records)} default / {len(records)} catalog records, "
        f"{default_asset['bytes']} + {catalog_asset['bytes']} bytes",
        flush=True,
    )


def main() -> int:
    args = parse_args()
    try:
        build_cache(args)
    except Exception as exc:
        if not args.fail_without_existing_cache and existing_cache_is_complete(
            args.output
        ):
            print(
                f"wildfire cache refresh failed; retaining complete prior cache: {exc}",
                file=sys.stderr,
            )
            return 0
        print(f"wildfire cache build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
