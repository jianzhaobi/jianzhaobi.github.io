#!/usr/bin/env python3
"""Build bounded, display-ready RAQDPS frames for the GitHub Pages map."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageFilter
except ImportError as exc:  # The Pages workflow installs these lightweight build deps.
    raise SystemExit("build_static_cache.py requires numpy and Pillow") from exc


UTC = dt.timezone.utc
HOUR = dt.timedelta(hours=1)
WMS = "https://geo.weather.gc.ca/geomet"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
FIELD_PREPARATION_VERSION = 2
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

SOURCE_COLORS = (
    (0.00, 238, 236, 255),
    (0.12, 93, 85, 231),
    (0.27, 19, 107, 232),
    (0.40, 17, 189, 215),
    (0.52, 87, 212, 122),
    (0.65, 241, 230, 76),
    (0.77, 255, 155, 36),
    (0.89, 238, 57, 40),
    (1.00, 92, 0, 16),
)

COLOR_RAMPS = {
    "smoke": (
        (0.00, 255, 248, 221, 0.00),
        (0.08, 255, 231, 180, 0.06),
        (0.22, 250, 193, 124, 0.16),
        (0.40, 239, 143, 87, 0.32),
        (0.58, 211, 94, 57, 0.48),
        (0.74, 164, 62, 43, 0.64),
        (0.88, 111, 41, 33, 0.78),
        (1.00, 61, 25, 23, 0.88),
    ),
    "total": (
        (0.00, 255, 250, 222, 0.00),
        (0.08, 250, 235, 181, 0.06),
        (0.22, 239, 208, 125, 0.16),
        (0.40, 216, 172, 78, 0.32),
        (0.58, 181, 129, 47, 0.48),
        (0.74, 137, 91, 34, 0.64),
        (0.88, 91, 56, 25, 0.78),
        (1.00, 50, 31, 19, 0.88),
    ),
}


@dataclass(frozen=True)
class Frame:
    key: str
    dataset: str
    particle: str
    extent: str
    hour: int
    relative_path: str
    url: str
    reference_time: dt.datetime
    valid_time: dt.datetime


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
                    dataset=dataset_name,
                    particle=particle,
                    extent=extent,
                    hour=relative_hour,
                    relative_path=relative_path,
                    url=frame_url(
                        layer,
                        style,
                        reference_time,
                        valid_time,
                        args.width,
                        args.height,
                    ),
                    reference_time=reference_time,
                    valid_time=valid_time,
                )
            )

    metadata = {
        "generatedAt": dt.datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "primaryReferenceTime": iso_hour(primary_reference),
        "currentValidTime": iso_hour(current_valid),
        "historyHours": args.history_hours,
        "forecastHours": future_hours,
        "sourceWidth": args.width,
        "sourceHeight": args.height,
        "displayWidth": round(args.width * args.spatial_scale),
        "displayHeight": round(args.height * args.spatial_scale),
    }
    return frames, metadata


def valid_image(
    path: Path,
    expected_size: tuple[int, int],
    expected_format: str,
) -> bool:
    try:
        if path.stat().st_size <= len(PNG_SIGNATURE):
            return False
        with Image.open(path) as image:
            if image.format != expected_format or image.size != expected_size:
                return False
            image.verify()
        return True
    except (OSError, ValueError):
        return False


def valid_png(path: Path, expected_size: tuple[int, int]) -> bool:
    return valid_image(path, expected_size, "PNG")


def valid_webp(path: Path, expected_size: tuple[int, int]) -> bool:
    return valid_image(path, expected_size, "WEBP")


def lossless_webp_matches(path: Path, expected_rgba: np.ndarray) -> bool:
    try:
        with Image.open(path) as image:
            decoded = np.asarray(image.convert("RGBA"), dtype=np.uint8)
        return decoded.shape == expected_rgba.shape and np.array_equal(
            decoded,
            expected_rgba,
        )
    except (OSError, ValueError):
        return False


def download_frame(
    frame: Frame,
    raw_output: Path,
    width: int,
    height: int,
    retries: int,
) -> tuple[Frame, str | None]:
    destination = raw_output / frame.relative_path
    if valid_png(destination, (width, height)):
        return frame, None

    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        frame.url,
        headers={"User-Agent": "na-smoke-map-cache/2.0 (+https://jianzhaobi.github.io/na_smoke_map/)"},
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
            if not valid_png(temporary, (width, height)):
                raise ValueError("response PNG was incomplete or the wrong size")
            temporary.replace(destination)
            return frame, None
        except Exception as exc:  # Network services can fail in several ways.
            error = str(exc)
            temporary.unlink(missing_ok=True)
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))

    return frame, error


def source_position(red: float, green: float, blue: float) -> float:
    best_distance = float("inf")
    best_position = 0.0
    for start, end in zip(SOURCE_COLORS, SOURCE_COLORS[1:]):
        dr, dg, db = end[1] - start[1], end[2] - start[2], end[3] - start[3]
        length_squared = dr * dr + dg * dg + db * db
        projection = (
            (red - start[1]) * dr
            + (green - start[2]) * dg
            + (blue - start[3]) * db
        ) / length_squared
        amount = max(0.0, min(1.0, projection))
        rr, gg, bb = start[1] + dr * amount, start[2] + dg * amount, start[3] + db * amount
        distance = (red - rr) ** 2 + (green - gg) ** 2 + (blue - bb) ** 2
        if distance < best_distance:
            best_distance = distance
            best_position = start[0] + (end[0] - start[0]) * amount
    return best_position


def source_position_lut() -> np.ndarray:
    result = np.empty(32 * 32 * 32, dtype=np.float32)
    for red in range(32):
        for green in range(32):
            for blue in range(32):
                result[(red << 10) | (green << 5) | blue] = source_position(
                    red * 8 + 4,
                    green * 8 + 4,
                    blue * 8 + 4,
                )
    return result


def palette_color(position: float, particle: str) -> tuple[int, int, int, float]:
    colors = COLOR_RAMPS[particle]
    for start, end in zip(colors, colors[1:]):
        if position > end[0]:
            continue
        amount = max(0.0, min(1.0, (position - start[0]) / (end[0] - start[0])))
        return (
            round(start[1] + (end[1] - start[1]) * amount),
            round(start[2] + (end[2] - start[2]) * amount),
            round(start[3] + (end[3] - start[3]) * amount),
            start[4] + (end[4] - start[4]) * amount,
        )
    final = colors[-1]
    return final[1], final[2], final[3], final[4]


SOURCE_POSITION_LUT = source_position_lut()
PIXEL_LUTS: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = {}


def pixel_lut(particle: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    if particle in PIXEL_LUTS:
        return PIXEL_LUTS[particle]
    colors = [palette_color(index / 1023, particle) for index in range(1024)]
    result = (
        np.asarray([color[0] for color in colors], dtype=np.uint8),
        np.asarray([color[1] for color in colors], dtype=np.uint8),
        np.asarray([color[2] for color in colors], dtype=np.uint8),
        np.asarray([color[3] for color in colors], dtype=np.float32),
    )
    PIXEL_LUTS[particle] = result
    return result


def prepare_display_frame(
    frame: Frame,
    raw_output: Path,
    output: Path,
    source_size: tuple[int, int],
    display_size: tuple[int, int],
    blur_radius: float,
) -> tuple[Frame, str | None]:
    destination = output / frame.relative_path
    if valid_png(destination, display_size):
        return frame, None

    temporary = destination.with_suffix(f".tmp-{os.getpid()}")
    try:
        raw_path = raw_output / frame.relative_path
        if not valid_png(raw_path, source_size):
            raise ValueError("raw frame unavailable")
        with Image.open(raw_path) as source:
            rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8).copy()

        source_alpha = rgba[:, :, 3].copy()
        mask = source_alpha > 2
        source_indexes = (
            (rgba[:, :, 0].astype(np.uint16) >> 3) << 10
            | (rgba[:, :, 1].astype(np.uint16) >> 3) << 5
            | (rgba[:, :, 2].astype(np.uint16) >> 3)
        )
        positions = np.where(mask, SOURCE_POSITION_LUT[source_indexes], 0.0)

        # Smooth the inferred scalar field before applying the display palette.
        # Filtering already-colored pixels preserves visible cell boundaries;
        # filtering the alpha-weighted scalar produces a continuous plume while
        # keeping the work entirely in the scheduled Pages cache build.
        weighted_source = np.rint(
            positions * source_alpha.astype(np.float32)
        ).astype(np.uint8)

        def smooth_channel(channel: np.ndarray) -> np.ndarray:
            image = Image.fromarray(channel).resize(
                display_size,
                resample=Image.Resampling.BICUBIC,
            )
            if blur_radius > 0:
                image = image.filter(ImageFilter.GaussianBlur(blur_radius))
            return np.asarray(image, dtype=np.float32)

        smooth_weighted = smooth_channel(weighted_source)
        smooth_coverage = smooth_channel(source_alpha)
        smooth_positions = np.divide(
            smooth_weighted,
            smooth_coverage,
            out=np.zeros_like(smooth_weighted),
            where=smooth_coverage > 0.5,
        )
        color_indexes = np.clip(
            np.rint(smooth_positions * 1023),
            0,
            1023,
        ).astype(np.uint16)
        red, green, blue, alpha = pixel_lut(frame.particle)
        display_rgba = np.zeros(
            (display_size[1], display_size[0], 4),
            dtype=np.uint8,
        )
        visible = smooth_coverage > 0.5
        display_rgba[:, :, 0][visible] = red[color_indexes[visible]]
        display_rgba[:, :, 1][visible] = green[color_indexes[visible]]
        display_rgba[:, :, 2][visible] = blue[color_indexes[visible]]
        display_rgba[:, :, 3][visible] = np.rint(
            smooth_coverage[visible] * alpha[color_indexes[visible]]
        ).astype(np.uint8)

        prepared = Image.fromarray(display_rgba)
        destination.parent.mkdir(parents=True, exist_ok=True)
        prepared.save(temporary, format="PNG", compress_level=6)
        if not valid_png(temporary, display_size):
            raise ValueError("display frame was incomplete")
        temporary.replace(destination)
        return frame, None
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        return frame, str(exc)


def prune_stale_frames(root: Path, retained: set[Path]) -> None:
    frames_root = root / "frames"
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


def timeline_hours(frames: list[Frame], successful_keys: set[str], datasets: list[str]) -> list[int]:
    available = {dataset: set() for dataset in datasets}
    for frame in frames:
        if frame.key in successful_keys:
            available[frame.dataset].add(frame.hour)
    common = set.intersection(*(available[dataset] for dataset in datasets)) if datasets else set()
    radius = 0
    while -(radius + 1) in common and radius + 1 in common:
        radius += 1
    return list(range(-radius, radius + 1)) if 0 in common else []


def build_field_packs(
    frames: list[Frame],
    successful_keys: set[str],
    raw_output: Path,
    output: Path,
    datasets: list[str],
    timeline: list[int],
    frame_size: tuple[int, int],
    blur_radius: float = 0.55,
    pack_size: int = 3,
) -> tuple[dict[str, list[dict[str, object]]], set[Path]]:
    frame_by_dataset_hour = {
        (frame.dataset, frame.hour): frame
        for frame in frames
        if frame.key in successful_keys
    }
    packs: dict[str, list[dict[str, object]]] = {dataset: [] for dataset in datasets}
    retained: set[Path] = set()

    for dataset in datasets:
        dataset_frames = {
            frame.hour: frame
            for frame in frames
            if frame.dataset == dataset and frame.key in successful_keys
        }
        timeline_groups: dict[dt.datetime, list[int]] = {}
        for hour in timeline:
            frame = frame_by_dataset_hour[(dataset, hour)]
            absolute_hour = int(
                frame.valid_time.timestamp() // HOUR.total_seconds()
            )
            group_start = dt.datetime.fromtimestamp(
                (absolute_hour // pack_size) * pack_size * HOUR.total_seconds(),
                UTC,
            )
            timeline_groups.setdefault(group_start, []).append(hour)

        for group_start, active_hours in sorted(timeline_groups.items()):
            weighted_pack = np.zeros(
                (frame_size[1], frame_size[0], 4),
                dtype=np.uint8,
            )
            coverage_pack = np.zeros_like(weighted_pack)
            # Keep alpha opaque. Browser decoders may discard RGB values behind
            # transparent alpha, so alpha cannot safely carry another hour.
            weighted_pack[:, :, 3] = 255
            coverage_pack[:, :, 3] = 255

            group_absolute_hour = int(
                group_start.timestamp() // HOUR.total_seconds()
            )
            channel_by_hour: dict[int, int] = {}
            for hour, frame in dataset_frames.items():
                absolute_hour = int(
                    frame.valid_time.timestamp() // HOUR.total_seconds()
                )
                channel = absolute_hour - group_absolute_hour
                if not 0 <= channel < pack_size:
                    continue
                raw_path = raw_output / frame.relative_path
                if not valid_png(raw_path, frame_size):
                    raise ValueError(f"raw frame unavailable for field pack: {frame.key}")
                with Image.open(raw_path) as source:
                    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8)

                source_alpha = rgba[:, :, 3]
                mask = source_alpha > 2
                source_indexes = (
                    (rgba[:, :, 0].astype(np.uint16) >> 3) << 10
                    | (rgba[:, :, 1].astype(np.uint16) >> 3) << 5
                    | (rgba[:, :, 2].astype(np.uint16) >> 3)
                )
                positions = np.where(mask, SOURCE_POSITION_LUT[source_indexes], 0.0)
                weighted = np.rint(
                    positions * source_alpha.astype(np.float32)
                ).astype(np.uint8)
                coverage = source_alpha.copy()
                if blur_radius > 0:
                    weighted = np.asarray(
                        Image.fromarray(weighted).filter(
                            ImageFilter.GaussianBlur(blur_radius)
                        ),
                        dtype=np.uint8,
                    )
                    coverage = np.asarray(
                        Image.fromarray(coverage).filter(
                            ImageFilter.GaussianBlur(blur_radius)
                        ),
                        dtype=np.uint8,
                    )
                weighted_pack[:, :, channel] = weighted
                coverage_pack[:, :, channel] = coverage
                channel_by_hour[hour] = channel

            if not all(hour in channel_by_hour for hour in active_hours):
                raise ValueError(
                    f"field atlas does not cover active hours for {dataset}"
                )

            atlas = np.zeros(
                (frame_size[1] * 2, frame_size[0], 4),
                dtype=np.uint8,
            )
            atlas[:, :, 3] = 255
            atlas[:frame_size[1], :, :] = weighted_pack
            atlas[frame_size[1]:, :, :] = coverage_pack
            temporary = output / f".field-atlas-{os.getpid()}.webp"
            Image.fromarray(atlas).save(
                temporary,
                format="WEBP",
                lossless=True,
                quality=100,
                method=4,
                exact=True,
            )
            digest = hashlib.sha256(temporary.read_bytes()).hexdigest()[:24]
            relative_path = f"fields/v5/{dataset}/{digest}.webp"
            destination = output / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                temporary.unlink(missing_ok=True)
            else:
                temporary.replace(destination)
            if not valid_webp(
                destination,
                (frame_size[0], frame_size[1] * 2),
            ):
                destination.unlink(missing_ok=True)
                raise ValueError(f"field atlas was incomplete: {relative_path}")
            if not lossless_webp_matches(destination, atlas):
                destination.unlink(missing_ok=True)
                raise ValueError(
                    f"field atlas did not decode byte-for-byte: {relative_path}"
                )
            retained.add(destination)
            ordered_hours = sorted(active_hours)
            packs[dataset].append({
                "path": relative_path,
                "hours": ordered_hours,
                "channels": [channel_by_hour[hour] for hour in ordered_hours],
            })

    return packs, retained


def prune_stale_fields(output: Path, retained: set[Path]) -> None:
    fields_root = output / "fields"
    if not fields_root.exists():
        return
    for pattern in ("*.png", "*.webp"):
        for path in fields_root.rglob(pattern):
            if path not in retained:
                path.unlink(missing_ok=True)
    for directory in sorted(fields_root.rglob("*"), reverse=True):
        if directory.is_dir():
            try:
                directory.rmdir()
            except OSError:
                pass


def reset_stale_display_cache(output: Path) -> None:
    manifest_path = output / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        manifest = {}
    fields_current = (
        manifest.get("fieldPreparationVersion") ==
        FIELD_PREPARATION_VERSION
    )
    if manifest.get("schemaVersion") == 5 and fields_current:
        return
    if not fields_current:
        shutil.rmtree(output / "fields", ignore_errors=True)
    shutil.rmtree(output / "frames", ignore_errors=True)
    shutil.rmtree(output / "previews", ignore_errors=True)
    manifest_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("cache"))
    parser.add_argument("--raw-output", type=Path)
    parser.add_argument("--history-hours", type=int, default=64)
    parser.add_argument("--forecast-hours", type=int, default=64)
    parser.add_argument("--width", type=int, default=1000)
    parser.add_argument("--height", type=int, default=625)
    parser.add_argument("--spatial-scale", type=float, default=1.5)
    parser.add_argument("--blur-radius", type=float, default=1.0)
    parser.add_argument("--jobs", type=int, default=8)
    parser.add_argument("--process-jobs", type=int, default=4)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--minimum-success-ratio", type=float, default=0.9)
    parser.add_argument("--now", type=parse_time)
    parser.add_argument(
        "--asset-base-url",
        default="",
        help="Optional public base URL for content-addressed field assets.",
    )
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        choices=sorted(DATASETS),
        help="Limit the build to one or more datasets; defaults to all four.",
    )
    args = parser.parse_args()
    args.datasets = args.datasets or list(DATASETS)
    args.raw_output = args.raw_output or args.output / "_source"
    if args.history_hours < 0 or args.forecast_hours < 0:
        parser.error("hour ranges must be non-negative")
    if (
        args.width < 1
        or args.height < 1
        or args.jobs < 1
        or args.process_jobs < 1
        or args.retries < 1
        or args.spatial_scale <= 0
        or args.blur_radius < 0
    ):
        parser.error("dimensions, scales, job counts, and retries must be valid")
    if not 0 <= args.minimum_success_ratio <= 1:
        parser.error("minimum success ratio must be between 0 and 1")
    return args


def main() -> int:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.raw_output.mkdir(parents=True, exist_ok=True)
    reset_stale_display_cache(args.output)
    frames, metadata = build_frames(args)
    download_failures: dict[str, str] = {}
    downloaded: list[Frame] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as executor:
        futures = {
            executor.submit(
                download_frame,
                frame,
                args.raw_output,
                args.width,
                args.height,
                args.retries,
            ): frame
            for frame in frames
        }
        for completed, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            frame, error = future.result()
            if error is None:
                downloaded.append(frame)
            else:
                download_failures[frame.key] = error
            if completed % 50 == 0 or completed == len(frames):
                print(f"downloaded {completed}/{len(frames)} source frames", flush=True)

    downloaded_keys = {frame.key for frame in downloaded}
    failures = download_failures
    ratio = len(downloaded) / len(frames) if frames else 0
    if failures:
        for key, error in list(failures.items())[:10]:
            print(f"failed {key}: {error}", file=sys.stderr)
        if len(failures) > 10:
            print(f"...and {len(failures) - 10} more failures", file=sys.stderr)
    if ratio < args.minimum_success_ratio:
        print(
            f"cache build rejected: {len(downloaded)}/{len(frames)} frames "
            f"({ratio:.1%}) succeeded",
            file=sys.stderr,
        )
        return 1

    retained_raw = {
        args.raw_output / frame.relative_path
        for frame in frames
        if frame.key in downloaded_keys
    }
    shutil.rmtree(args.output / "frames", ignore_errors=True)
    prune_stale_frames(args.raw_output, retained_raw)
    available_hours = timeline_hours(frames, downloaded_keys, args.datasets)
    if not available_hours:
        print("cache build rejected: no common frame exists at Now", file=sys.stderr)
        return 1
    try:
        field_packs, retained_fields = build_field_packs(
            frames,
            downloaded_keys,
            args.raw_output,
            args.output,
            args.datasets,
            available_hours,
            (args.width, args.height),
        )
    except Exception as exc:
        print(f"cache build rejected: unable to prepare smooth field packs: {exc}", file=sys.stderr)
        return 1
    prune_stale_fields(args.output, retained_fields)

    manifest = {
        "schemaVersion": 5,
        **metadata,
        "fieldPreparationVersion": FIELD_PREPARATION_VERSION,
        "frameIntervalMinutes": 60,
        "visualInterpolation": "premultiplied-alpha",
        "timelineHours": available_hours,
        "fieldTimeline": {
            "frameWidth": args.width,
            "frameHeight": args.height,
            "packSize": 3,
            "encoding": "lossless-webp-rgba",
            "atlasLayout": "weighted-over-coverage",
            "assetBaseUrl": (
                args.asset_base_url.rstrip("/") + "/"
                if args.asset_base_url
                else ""
            ),
            "spatialInterpolation": "gpu-linear-smoothed-field",
            "packs": field_packs,
        },
        "frameCount": len(downloaded),
        "failureCount": len(failures),
    }
    temporary_manifest = args.output / "manifest.json.tmp"
    temporary_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary_manifest.replace(args.output / "manifest.json")
    print(
        f"cache ready: {len(downloaded)} source frames, {len(failures)} failures, "
        f"{ratio:.1%} success, {sum(len(items) for items in field_packs.values())} "
        f"field atlases, timeline {available_hours[0]:+d}…{available_hours[-1]:+d} h"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
