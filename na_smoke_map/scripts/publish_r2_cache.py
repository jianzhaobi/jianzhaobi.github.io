#!/usr/bin/env python3
"""Upload content-addressed schema-v5 field atlases to Cloudflare R2."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from pathlib import Path

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError as exc:
    raise SystemExit("publish_r2_cache.py requires boto3") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--endpoint-url", required=True)
    parser.add_argument("--prefix", default="")
    return parser.parse_args()


def manifest_assets(manifest: dict[str, object]) -> list[str]:
    if manifest.get("schemaVersion") != 5:
        raise ValueError("R2 publication requires a schema-v5 manifest")
    timeline = manifest.get("fieldTimeline")
    if not isinstance(timeline, dict):
        raise ValueError("schema-v5 field timeline is missing")
    packs = timeline.get("packs")
    if not isinstance(packs, dict):
        raise ValueError("schema-v5 field packs are missing")
    assets: set[str] = set()
    for dataset_packs in packs.values():
        if not isinstance(dataset_packs, list):
            raise ValueError("schema-v5 dataset packs are invalid")
        for pack in dataset_packs:
            if not isinstance(pack, dict) or not isinstance(pack.get("path"), str):
                raise ValueError("schema-v5 field path is invalid")
            assets.add(pack["path"])
    return sorted(assets)


def main() -> int:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    assets = manifest_assets(manifest)
    client = boto3.client("s3", endpoint_url=args.endpoint_url)
    prefix = args.prefix.strip("/")
    uploaded = 0
    reused = 0

    for relative_path in assets:
        source = args.root / relative_path
        if not source.is_file():
            raise FileNotFoundError(f"manifest asset is missing: {source}")
        key = "/".join(part for part in (prefix, relative_path) if part)
        size = source.stat().st_size
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        try:
            metadata = client.head_object(Bucket=args.bucket, Key=key)
            if int(metadata.get("ContentLength", -1)) != size:
                raise ValueError(f"R2 object size mismatch: {key}")
            if metadata.get("Metadata", {}).get("sha256") != digest:
                raise ValueError(f"R2 object digest mismatch: {key}")
            reused += 1
            continue
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status != 404:
                raise

        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        client.upload_file(
            str(source),
            args.bucket,
            key,
            ExtraArgs={
                "CacheControl": "public, max-age=31536000, immutable",
                "ContentType": content_type,
                "Metadata": {"sha256": digest},
            },
        )
        metadata = client.head_object(Bucket=args.bucket, Key=key)
        if (
            int(metadata.get("ContentLength", -1)) != size
            or metadata.get("Metadata", {}).get("sha256") != digest
        ):
            raise ValueError(f"R2 upload verification failed: {key}")
        uploaded += 1

    print(f"R2 fields ready: {uploaded} uploaded, {reused} reused")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
