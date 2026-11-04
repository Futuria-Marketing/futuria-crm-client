#!/usr/bin/env python3
"""Build a reproducible customer plugin from a committed, explicit file set."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOP_FILES = {
    "plugin.json", "mcp.json", ".mcp.json", "README.md", "INSTALL.md",
    "PRIVACY.md", "SECURITY.md", "LICENSE", "LICENSE.md", "CHANGELOG.md",
    ".codex-plugin/plugin.json", ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json",
}
PREFIXES = ("skills/futuria-crm/", "commands/", "assets/")
EXTENSIONS = {".md", ".json", ".yaml", ".yml", ".ps1", ".sh", ".mjs", ".js", ".html", ".css", ".png", ".svg"}
REQUIRED = {
    "plugin.json", "mcp.json", ".mcp.json", ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json",
    ".agents/plugins/marketplace.json", "skills/futuria-crm/SKILL.md",
    "skills/futuria-crm/VERSION", "commands/futuria-crm.md", "INSTALL.md",
    "PRIVACY.md", "SECURITY.md",
}


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True).stdout


def selected_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    if name in TOP_FILES:
        return True
    if not name.startswith(PREFIXES):
        return False
    if any(part.startswith(".") or part in {"node_modules", "__pycache__"} for part in path.parts):
        raise ValueError(f"Unexpected private/generated file in product tree: {name}")
    if path.suffix not in EXTENSIONS and path.name != "VERSION":
        raise ValueError(f"Unexpected file type in product tree: {name}")
    return True


def committed_payload(root):
    revision = git(root, "rev-parse", "HEAD").decode().strip()
    for raw_name in git(root, "diff", "--name-only", "-z", "HEAD", "--").split(b"\0"):
        if raw_name and selected_path(raw_name.decode("utf-8")):
            raise ValueError(f"Product file differs from committed source: {raw_name.decode('utf-8')}")
    payload = {}
    for row in git(root, "ls-tree", "-rz", "--full-tree", "HEAD").split(b"\0"):
        if not row:
            continue
        header, raw_name = row.split(b"\t", 1)
        mode, kind, object_id = header.decode().split()
        name = raw_name.decode("utf-8")
        if not selected_path(name):
            continue
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError(f"Links and special files cannot ship: {name}")
        data = git(root, "cat-file", "blob", object_id)
        current = root / name
        if current.is_symlink() or not current.is_file():
            raise ValueError(f"Product file is missing or a link: {name}")
        payload[name] = (data, mode)
    # Refuse uncommitted product additions too; never silently omit a new manifest.
    for raw_name in git(root, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0"):
        if raw_name and selected_path(raw_name.decode("utf-8")):
            raise ValueError(f"Uncommitted product file: {raw_name.decode('utf-8')}")
    missing = REQUIRED - payload.keys()
    if missing:
        raise ValueError(f"Missing committed product files: {', '.join(sorted(missing))}")
    return revision, payload


def package_version(payload):
    versions = set()
    for name in ("plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"):
        versions.add(json.loads(payload[name][0])["version"])
    versions.add(payload["skills/futuria-crm/VERSION"][0].decode().strip())
    versions.add(json.loads(payload[".claude-plugin/marketplace.json"][0])["plugins"][0]["version"])
    if len(versions) != 1:
        raise ValueError("Product versions are not aligned")
    version = versions.pop()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Stable release requires a numeric semantic version")
    return version


def archive_bytes(payload):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, (data, mode) in sorted(payload.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (int(mode, 8) << 16)
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data, compresslevel=9)
    return buffer.getvalue()


def build(root, output, expected_tag=None):
    revision, payload = committed_payload(root)
    version = package_version(payload)
    if expected_tag is not None and expected_tag != f"v{version}":
        raise ValueError(f"Release tag {expected_tag} does not match v{version}")
    output.mkdir(parents=True, exist_ok=True)
    filename = f"futuria-crm-{version}.zip"
    data = archive_bytes(payload)
    receipt = {
        "name": "futuria-crm", "version": version, "source_commit": revision,
        "archive": filename, "sha256": hashlib.sha256(data).hexdigest(),
        "files": {name: hashlib.sha256(item[0]).hexdigest() for name, item in sorted(payload.items())},
    }
    (output / filename).write_bytes(data)
    manifest_name = f"futuria-crm-{version}.manifest.json"
    manifest_data = (json.dumps(receipt, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    (output / manifest_name).write_bytes(manifest_data)
    (output / "SHA256SUMS").write_text(
        f"{receipt['sha256']}  {filename}\n{hashlib.sha256(manifest_data).hexdigest()}  {manifest_name}\n",
        encoding="utf-8", newline="\n",
    )
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tag", help="Require an exact vX.Y.Z release tag")
    args = parser.parse_args()
    receipt = build(ROOT, args.output.resolve(), args.tag)
    print(json.dumps({key: receipt[key] for key in ("name", "version", "source_commit", "archive", "sha256")}))
