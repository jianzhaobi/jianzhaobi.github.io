#!/usr/bin/env python3
"""Build a bounded, same-origin RAQDPS frame cache for GitHub Pages."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path


UTC = dt.timezone.utc
HOUR = dt.timedelta(hours=1)
WMS = "https://geo.weather.gc.ca/geomet"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
BOUNDS = (-18924313.434856508, 1804722.766257292, -5788613.521250226, 13377019.784465117)

DATASETS = {
    "smoke-surface": (
        "smoke",
        "surface",
        "RAQDPS.Sfc_PM2.5-WildfireSmokePlume",
        "PM2.5_1to250ugm3",
    ),
    "smoke-column": (
        "smoke",
        "column",
        "RAQDPS.EAtm_PM2.5-WildfireSmokePlume",
        "PM2.5_EAtm_1e-7to2e-4kgm2",
    ),
    "total-surface": (
        "total",
        "surface",
        "RAQDPS.SFC_PM2.5",
        "PM2.5_1to250ugm3",
    ),
    "total-column": (
        "total",
        "column",
        "RAQDPS.EATM_PM2.5",
        "PM2.5_EAtm_1e-7to2e-4kgm2",
    ),
}


@dataclass(frozen=True)
class Frame:
    key: str
    relative_path: str
    url: str


def parse_time(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def floor_hour(value: dt.datetime) -> dt.datetime:
    return value.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def iso_hour(value: dt.datetime) -> str:
    return floor_hour(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def compact_hour(value: dt.datetime) -> str:
    return floor_hour(value).strftime("%Y%m%dT%HZ")


def latest_likely_run(now: dt.datetime) -> dt.datetime:
    conservative = now - dt.timedelta(hours=7)
    return conservative.replace(
        hour=12 if conservative.hour >= 12 else 0,
        minute=0,
        second=0,
        microsecond=0,
    )


def latest_run_at_or_before(value: dt.datetime) -> dt.datetime:
    return value.replace(
        hour=12 if value.hour >= 12 else 0,
        minute=0,
        second=0,
        microsecond=0,
    )


def frame_url(
    layer: str,
    style: str,
    reference_time: dt.datetime,
    valid_time: dt.datetime,
    width: int,
    height: int,
) -> str:
    params = {
        "service": "WMS",
        "request": "GetMap",
        "version": "1.3.0",
        "layers": layer,
        "styles": style,
        "crs": "EPSG:3857",
        "bbox": ",".join(str(value) for value in BOUNDS),
        "width": str(width),
        "height": str(height),
        "format": "image/png",
        "transparent": "true",
        "TIME": iso_hour(valid_time),
        "DIM_REFERENCE_TIME": iso_hour(reference_time),
    }
    return f"{WMS}?{urllib.parse.urlencode(params)}"


def build_frames(args: argparse.Namespace) -> tuple[list[Frame], dict[str, object]]:
    now = floor_hour(args.now or dt.datetime.now(UTC))
    primary_reference = latest_likely_run(now)
    current_index = max(0, min(72, round((now - primary_reference) / HOUR)))
    current_valid = primary_reference + current_index * HOUR
    available_future = max(0, 72 - current_index)
    future_hours = min(args.forecast_hours, available_future)
    frames: list[Frame] = []

    for relative_hour in range(-args.history_hours, future_hours + 1):
        valid_time = current_valid + relative_hour * HOUR
        primary_index = current_index + relative_hour
        reference_time = (
            primary_reference
            if 0 <= primary_index <= 72
            else latest_run_at_or_before(valid_time)
        )
        model_hour = round((valid_time - reference_time) / HOUR)
        if not 0 <= model_hour <= 72:
            continue

        for dataset_name in args.datasets:
            particle, extent, layer, style = DATASETS[dataset_name]
            key = "|".join(
                (particle, extent, iso_hour(reference_time), iso_hour(valid_time))
            )
            relative_path = (
                f"frames/{dataset_name}/{compact_hour(reference_time)}/"
                f"{compact_hour(valid_time)}.png"
            )
            frames.append(
                Frame(
                    key=key,
                    relative_path=relative_path,
                    url=frame_url(
                        layer,
                        style,
                        reference_time,
                        valid_time,
                        args.width,
                        args.height,
                    ),
                )
            )

    metadata = {
        "generatedAt": dt.datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "primaryReferenceTime": iso_hour(primary_reference),
        "currentValidTime": iso_hour(current_valid),
        "historyHours": args.history_hours,
        "forecastHours": future_hours,
        "width": args.width,
        "height": args.height,
    }
    return frames, metadata


def valid_png(path: Path) -> bool:
    try:
        if path.stat().st_size <= len(PNG_SIGNATURE):
            return False
        with path.open("rb") as source:
            return source.read(8) == PNG_SIGNATURE
    except OSError:
        return False


def download_frame(frame: Frame, output: Path, retries: int) -> tuple[Frame, str | None]:
    destination = output / frame.relative_path
    if valid_png(destination):
        return frame, None

    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        frame.url,
        headers={"User-Agent": "na-smoke-map-cache/1.0 (+https://jianzhaobi.github.io/na_smoke_map/)"},
    )
    error = "unknown error"

    for attempt in range(retries):
        temporary = destination.with_suffix(f".tmp-{os.getpid()}-{attempt}")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
            if not payload.startswith(PNG_SIGNATURE):
                raise ValueError("response was not a PNG")
            temporary.write_bytes(payload)
            temporary.replace(destination)
            return frame, None
        except Exception as exc:  # Network services can fail in several ways.
            error = str(exc)
            temporary.unlink(missing_ok=True)
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))

    return frame, error


def prune_stale_frames(output: Path, retained: set[Path]) -> None:
    frames_root = output / "frames"
    if not frames_root.exists():
        return
    for path in frames_root.rglob("*.png"):
        if path not in retained:
            path.unlink(missing_ok=True)
    for directory in sorted(frames_root.rglob("*"), reverse=True):
        if directory.is_dir():
            try:
                directory.rmdir()
            except OSError:
                pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("cache"))
    parser.add_argument("--history-hours", type=int, default=72)
    parser.add_argument("--forecast-hours", type=int, default=72)
    parser.add_argument("--width", type=int, default=1000)
    parser.add_argument("--height", type=int, default=625)
    parser.add_argument("--jobs", type=int, default=8)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--minimum-success-ratio", type=float, default=0.9)
    parser.add_argument("--now", type=parse_time)
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        choices=sorted(DATASETS),
        help="Limit the build to one or more datasets; defaults to all four.",
    )
    args = parser.parse_args()
    args.datasets = args.datasets or list(DATASETS)
    if args.history_hours < 0 or args.forecast_hours < 0:
        parser.error("hour ranges must be non-negative")
    if args.width < 1 or args.height < 1 or args.jobs < 1 or args.retries < 1:
        parser.error("image dimensions, jobs, and retries must be positive")
    if not 0 <= args.minimum_success_ratio <= 1:
        parser.error("minimum success ratio must be between 0 and 1")
    return args


def main() -> int:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    frames, metadata = build_frames(args)
    successes: dict[str, str] = {}
    failures: dict[str, str] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as executor:
        futures = {
            executor.submit(download_frame, frame, args.output, args.retries): frame
            for frame in frames
        }
        for completed, future in enumerate(
            concurrent.futures.as_completed(futures),
            start=1,
        ):
            frame, error = future.result()
            if error is None:
                successes[frame.key] = frame.relative_path
            else:
                failures[frame.key] = error
            if completed % 50 == 0 or completed == len(frames):
                print(f"processed {completed}/{len(frames)} frames", flush=True)

    ratio = len(successes) / len(frames) if frames else 0
    if failures:
        for key, error in list(failures.items())[:10]:
            print(f"failed {key}: {error}", file=sys.stderr)
        if len(failures) > 10:
            print(f"...and {len(failures) - 10} more failures", file=sys.stderr)
    if ratio < args.minimum_success_ratio:
        print(
            f"cache build rejected: {len(successes)}/{len(frames)} frames "
            f"({ratio:.1%}) succeeded",
            file=sys.stderr,
        )
        return 1

    retained = {args.output / path for path in successes.values()}
    prune_stale_frames(args.output, retained)
    manifest = {
        "schemaVersion": 1,
        **metadata,
        "frameCount": len(successes),
        "failureCount": len(failures),
        "frames": dict(sorted(successes.items())),
    }
    temporary_manifest = args.output / "manifest.json.tmp"
    temporary_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary_manifest.replace(args.output / "manifest.json")
    print(
        f"cache ready: {len(successes)} frames, {len(failures)} fallbacks, "
        f"{ratio:.1%} success"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
