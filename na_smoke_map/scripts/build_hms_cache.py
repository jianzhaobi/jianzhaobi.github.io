#!/usr/bin/env python3
"""Build an atomic, browser-ready hourly NOAA HMS smoke-polygon cache."""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


UTC = dt.timezone.utc
EASTERN = ZoneInfo("America/New_York")
HMS_SERVICE = (
    "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/"
    "NOAA_Satellite_Smoke_Detection_(v1)/FeatureServer/0"
)
HMS_ARCHIVE_ROOT = (
    "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/"
    "Smoke_Polygons/KML"
)
HMS_FIELDS = "Density,Satellite,Start,End_"
PAGE_SIZE = 2000
MAXIMUM_PAGES = 100
KML_NAMESPACE = {"kml": "http://www.opengis.net/kml/2.2"}
KNOWN_DENSITIES = {"light": "Light", "medium": "Medium", "heavy": "Heavy"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--archive-lookback-days", type=int, default=14)
    parser.add_argument(
        "--fail-without-existing-cache",
        action="store_true",
        help="Fail instead of retaining an already-published complete cache.",
    )
    args = parser.parse_args()
    if args.retries < 1 or args.archive_lookback_days < 1:
        parser.error("retries and archive-lookback-days must be positive")
    return args


def iso_time(value: dt.datetime | None = None) -> str:
    return (value or dt.datetime.now(UTC)).astimezone(UTC).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def serialize(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def request_bytes(
    url: str,
    retries: int,
    *,
    parameters: dict[str, Any] | None = None,
    optional_not_found: bool = False,
) -> tuple[bytes, Any] | None:
    if parameters:
        encoded = urllib.parse.urlencode(
            {
                name: value
                for name, value in parameters.items()
                if value is not None and value != ""
            }
        )
        url = f"{url}?{encoded}"
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json, application/vnd.google-earth.kml+xml",
                "User-Agent": "na-smoke-map-cache/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=75) as response:
                return response.read(), response.headers
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and optional_not_found:
                return None
            last_error = exc
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
        if attempt < retries - 1:
            time.sleep((0.5, 1.5, 3.0)[min(attempt, 2)])
    raise RuntimeError(f"HMS request failed: {last_error}") from last_error


def request_json(
    url: str,
    parameters: dict[str, Any],
    retries: int,
) -> dict[str, Any]:
    result = request_bytes(url, retries, parameters=parameters)
    if result is None:
        raise RuntimeError(f"HMS JSON request unexpectedly returned no data: {url}")
    content, _headers = result
    try:
        payload = json.loads(content)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"HMS response is not valid JSON: {url}") from exc
    if payload.get("error"):
        error = payload["error"]
        raise RuntimeError(
            f"ArcGIS {error.get('code')}: {error.get('message')}"
        )
    return payload


def fetch_live_source(
    retries: int,
    now: dt.datetime,
) -> dict[str, Any]:
    metadata = request_json(HMS_SERVICE, {"f": "json"}, retries)
    features: list[dict[str, Any]] = []
    offset = 0
    for page_index in range(MAXIMUM_PAGES):
        payload = request_json(
            f"{HMS_SERVICE}/query",
            {
                "where": "1=1",
                "outFields": HMS_FIELDS,
                "returnGeometry": "true",
                "outSR": 4326,
                "geometryPrecision": 5,
                "orderByFields": "FID ASC",
                "f": "geojson",
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
            },
            retries,
        )
        page = payload.get("features")
        if not isinstance(page, list):
            raise ValueError("HMS ArcGIS response has no feature page")
        features.extend(
            feature for feature in page if feature.get("geometry")
        )
        exceeded = bool(payload.get("exceededTransferLimit"))
        if len(page) < PAGE_SIZE and not exceeded:
            break
        if not page:
            raise RuntimeError("HMS ArcGIS pagination stopped early")
        offset += len(page)
        if page_index == MAXIMUM_PAGES - 1:
            raise RuntimeError("HMS ArcGIS pagination limit exceeded")

    edit_value = metadata.get("editingInfo", {}).get("dataLastEditDate")
    source_updated_at = None
    try:
        source_updated_at = iso_time(
            dt.datetime.fromtimestamp(int(edit_value) / 1000, UTC)
        )
    except (TypeError, ValueError, OSError):
        pass
    return {
        "features": features,
        "sourceKind": "live",
        "sourceUrl": HMS_SERVICE,
        "sourceUpdatedAt": source_updated_at,
        "analysisDate": now.astimezone(EASTERN).date().isoformat(),
    }


def archive_url(day: dt.date) -> str:
    return (
        f"{HMS_ARCHIVE_ROOT}/{day:%Y}/{day:%m}/"
        f"hms_smoke{day:%Y%m%d}.kml"
    )


def parse_hms_timestamp(value: Any) -> dt.datetime | None:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) < 11:
        return None
    try:
        year = int(digits[:4])
        day_of_year = int(digits[4:7])
        hour = int(digits[7:9])
        minute = int(digits[9:11])
        return (
            dt.datetime(year, 1, 1, tzinfo=UTC)
            + dt.timedelta(
                days=day_of_year - 1,
                hours=hour,
                minutes=minute,
            )
        )
    except (TypeError, ValueError, OverflowError):
        return None


def description_field(description: str, label: str) -> str | None:
    match = re.search(
        rf"{re.escape(label)}:\s*([^<]+)",
        description,
        flags=re.IGNORECASE,
    )
    return match.group(1).strip() if match else None


def parse_coordinate_ring(value: str | None) -> list[list[float]]:
    ring: list[list[float]] = []
    for token in (value or "").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            ring.append([round(float(parts[0]), 5), round(float(parts[1]), 5)])
        except (TypeError, ValueError):
            continue
    if len(ring) >= 3 and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring if len(ring) >= 4 else []


def parse_archive_kml(content: bytes) -> list[dict[str, Any]]:
    root = ET.fromstring(content)
    features: list[dict[str, Any]] = []
    for placemark in root.findall(".//kml:Placemark", KML_NAMESPACE):
        description = placemark.findtext("kml:description", "", KML_NAMESPACE)
        density_value = description_field(description, "Density") or ""
        density = KNOWN_DENSITIES.get(density_value.strip().lower(), "Unknown")
        satellite = description_field(description, "Satellite")
        start = description_field(description, "Start Time")
        end = description_field(description, "End Time")
        if start:
            start = re.sub(r"\s*UTC\s*$", "", start, flags=re.IGNORECASE)
        if end:
            end = re.sub(r"\s*UTC\s*$", "", end, flags=re.IGNORECASE)

        polygons: list[list[list[list[float]]]] = []
        for polygon in placemark.findall(".//kml:Polygon", KML_NAMESPACE):
            outer_text = polygon.findtext(
                "kml:outerBoundaryIs/kml:LinearRing/kml:coordinates",
                "",
                KML_NAMESPACE,
            )
            outer = parse_coordinate_ring(outer_text)
            if not outer:
                continue
            rings = [outer]
            for inner_node in polygon.findall(
                "kml:innerBoundaryIs/kml:LinearRing/kml:coordinates",
                KML_NAMESPACE,
            ):
                inner = parse_coordinate_ring(inner_node.text)
                if inner:
                    rings.append(inner)
            polygons.append(rings)
        if not polygons:
            continue
        geometry: dict[str, Any]
        if len(polygons) == 1:
            geometry = {"type": "Polygon", "coordinates": polygons[0]}
        else:
            geometry = {"type": "MultiPolygon", "coordinates": polygons}
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "Density": density,
                    "Satellite": satellite,
                    "Start": start,
                    "End_": end,
                },
            }
        )
    return features


def fetch_archive_source(
    retries: int,
    now: dt.datetime,
    lookback_days: int,
) -> dict[str, Any]:
    today = now.astimezone(EASTERN).date()
    last_error: Exception | None = None
    for offset in range(lookback_days):
        day = today - dt.timedelta(days=offset)
        url = archive_url(day)
        try:
            result = request_bytes(
                url,
                retries,
                optional_not_found=True,
            )
        except Exception as exc:
            last_error = exc
            continue
        if result is None:
            continue
        content, headers = result
        features = parse_archive_kml(content)
        if not features:
            continue
        source_updated_at = None
        try:
            modified = email.utils.parsedate_to_datetime(
                headers.get("Last-Modified")
            )
            if modified:
                source_updated_at = iso_time(modified)
        except (TypeError, ValueError):
            pass
        return {
            "features": features,
            "sourceKind": "archive",
            "sourceUrl": url,
            "sourceUpdatedAt": source_updated_at,
            "analysisDate": day.isoformat(),
        }
    detail = f": {last_error}" if last_error else ""
    raise RuntimeError(
        f"No HMS archive with polygons found in the last {lookback_days} days{detail}"
    )


def observation_window(
    features: list[dict[str, Any]],
) -> tuple[str | None, str | None]:
    starts = [
        value
        for feature in features
        if (
            value := parse_hms_timestamp(
                feature.get("properties", {}).get("Start")
            )
        )
    ]
    ends = [
        value
        for feature in features
        if (
            value := parse_hms_timestamp(
                feature.get("properties", {}).get("End_")
            )
        )
    ]
    return (
        iso_time(min(starts)) if starts else None,
        iso_time(max(ends)) if ends else None,
    )


def write_asset(
    output: Path,
    payload: dict[str, Any],
) -> dict[str, Any]:
    content = serialize(payload)
    digest = hashlib.sha256(content).hexdigest()
    filename = f"polygons.{digest[:16]}.json"
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
        manifest = json.loads(
            (output / "manifest.json").read_text(encoding="utf-8")
        )
        if manifest.get("schemaVersion") != 1:
            return False
        descriptor = manifest["asset"]
        content = (output / descriptor["path"]).read_bytes()
        if len(content) != int(descriptor["bytes"]):
            return False
        if hashlib.sha256(content).hexdigest() != descriptor["sha256"]:
            return False
        payload = json.loads(content)
        return (
            payload.get("schemaVersion") == 1
            and payload.get("generatedAt") == manifest.get("generatedAt")
            and isinstance(payload.get("features"), list)
        )
    except (OSError, TypeError, ValueError, KeyError):
        return False


def build_cache(
    args: argparse.Namespace,
    *,
    now: dt.datetime | None = None,
) -> None:
    current_time = (now or dt.datetime.now(UTC)).astimezone(UTC)
    args.output.mkdir(parents=True, exist_ok=True)
    live_error: Exception | None = None
    try:
        selected = fetch_live_source(args.retries, current_time)
    except Exception as exc:
        live_error = exc
        selected = {"features": []}

    if not selected["features"]:
        selected = fetch_archive_source(
            args.retries,
            current_time,
            args.archive_lookback_days,
        )
        if live_error:
            print(
                f"live HMS source unavailable; using NOAA archive: {live_error}",
                file=sys.stderr,
            )
        else:
            print(
                "live HMS source has no polygons; using latest NOAA archive",
                flush=True,
            )

    features = selected["features"]
    observed_start, observed_end = observation_window(features)
    generated_at = iso_time(current_time)
    payload = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "analysisDate": selected["analysisDate"],
        "observedStart": observed_start,
        "observedEnd": observed_end,
        "features": features,
    }
    asset = write_asset(args.output, payload)
    manifest = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "refreshIntervalMinutes": 60,
        "source": "NOAA HMS Smoke Detection",
        "sourceKind": selected["sourceKind"],
        "sourceUrl": selected["sourceUrl"],
        "sourceUpdatedAt": selected.get("sourceUpdatedAt"),
        "analysisDate": selected["analysisDate"],
        "observedStart": observed_start,
        "observedEnd": observed_end,
        "polygonCount": len(features),
        "asset": asset,
    }
    temporary_manifest = args.output / "manifest.json.tmp"
    temporary_manifest.write_bytes(serialize(manifest))
    os.replace(temporary_manifest, args.output / "manifest.json")

    retained = {"manifest.json", asset["path"]}
    for candidate in args.output.glob("*.json"):
        if candidate.name not in retained:
            candidate.unlink(missing_ok=True)
    print(
        "HMS cache ready: "
        f"{len(features)} polygons from {selected['sourceKind']} "
        f"analysis {selected['analysisDate']} ({asset['bytes']} bytes)",
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
                f"HMS cache refresh failed; retaining complete prior cache: {exc}",
                file=sys.stderr,
            )
            return 0
        print(f"HMS cache build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
