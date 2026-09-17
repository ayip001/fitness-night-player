"""Temporary R2 helpers for the fitness-night audio cache.

Reads credentials from prologue.run .env.local. Prefix is isolated so it
can be deleted later without touching race images.
"""

from __future__ import annotations

import mimetypes
import os
import pathlib
import sys

import boto3
from botocore.config import Config

PROLOGUE_ENV = pathlib.Path(r"C:\Users\USER\Documents\GitHub\prologue.run\.env.local")
AUDIO_DIR = pathlib.Path(r"C:\Users\USER\Documents\Tmp\fitness-night-player\audio")
PREFIX = "tmp-fitness-night/"
CDN_BASE = "https://images.prologue.run"
PLAYER_ORIGINS = [
    "https://ayip001.github.io",
    "https://angusyeet.com",
    "http://angusyeet.com",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
]


def load_env(path: pathlib.Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def client():
    env = load_env(PROLOGUE_ENV)
    return boto3.client(
        "s3",
        endpoint_url=env["R2_ENDPOINT"],
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4"),
    ), env["R2_BUCKET_NAME"]


def current_cors(s3, bucket: str) -> dict:
    try:
        return s3.get_bucket_cors(Bucket=bucket)
    except s3.exceptions.ClientError as error:
        if error.response["Error"]["Code"] in {"NoSuchCORSConfiguration", "NoSuchCORSConfigurationError"}:
            return {"CORSRules": []}
        raise


def ensure_cors(s3, bucket: str) -> None:
    existing = current_cors(s3, bucket).get("CORSRules", [])
    have = {origin for rule in existing for origin in rule.get("AllowedOrigins", [])}
    missing = [origin for origin in PLAYER_ORIGINS if origin not in have]
    if not missing and existing:
        print("CORS already allows player origins")
        return

    rules = existing or []
    rules.append(
        {
            "AllowedOrigins": PLAYER_ORIGINS,
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedHeaders": ["*"],
            "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
            "MaxAgeSeconds": 86400,
        }
    )
    s3.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": rules})
    print("Updated CORS with player origins")


def upload() -> None:
    s3, bucket = client()
    files = sorted(AUDIO_DIR.glob("*.mp3"))
    if len(files) != 35:
        raise SystemExit(f"Expected 35 mp3 files, found {len(files)}")

    for index, path in enumerate(files, start=1):
        key = f"{PREFIX}{path.name}"
        print(f"[{index}/35] {key} ({path.stat().st_size} bytes)")
        s3.upload_file(
            str(path),
            bucket,
            key,
            ExtraArgs={
                "ContentType": "audio/mpeg",
                "CacheControl": "public, max-age=86400",
            },
        )
    print(f"Done. Base URL: {CDN_BASE}/{PREFIX}")


def list_temp() -> None:
    s3, bucket = client()
    response = s3.list_objects_v2(Bucket=bucket, Prefix=PREFIX)
    contents = response.get("Contents") or []
    total = 0
    for item in contents:
        total += item["Size"]
        print(f"{item['Size']:10d}  {item['Key']}")
    print(f"{len(contents)} objects, {total} bytes")


def delete_temp() -> None:
    s3, bucket = client()
    response = s3.list_objects_v2(Bucket=bucket, Prefix=PREFIX)
    contents = response.get("Contents") or []
    if not contents:
        print("Nothing to delete")
        return
    objects = [{"Key": item["Key"]} for item in contents]
    s3.delete_objects(Bucket=bucket, Delete={"Objects": objects, "Quiet": True})
    print(f"Deleted {len(objects)} objects under {PREFIX}")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "upload"
    if command == "upload":
        upload()
    elif command == "list":
        list_temp()
    elif command == "delete":
        delete_temp()
    elif command == "cors":
        s3, bucket = client()
        ensure_cors(s3, bucket)
        print(current_cors(s3, bucket))
    else:
        raise SystemExit("Usage: r2_audio.py [upload|list|delete|cors]")
