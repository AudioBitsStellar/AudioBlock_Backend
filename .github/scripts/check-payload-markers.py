#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path


SIGNATURE = re.compile(r"""\bglobal\s*\[\s*['"]!\s*['"]\s*\]""", re.DOTALL)
FIXTURE = Path("tests/fixtures/polinrider-signature.fixture")
WORKFLOW = Path(".github/workflows/block-payload.yml")
SCRIPT_SUFFIXES = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"}
CONFIG_SUFFIXES = {
    ".cfg",
    ".conf",
    ".env",
    ".ini",
    ".json",
    ".jsonc",
    ".properties",
    ".toml",
    ".xml",
    ".yaml",
    ".yml",
}


def is_scanned_file(path: Path) -> bool:
    name = path.name.lower()
    return (
        path.suffix.lower() in SCRIPT_SUFFIXES | CONFIG_SUFFIXES
        or (name.startswith(".") and name not in {".gitignore", ".gitattributes"})
        or "config" in name
    )


def main() -> int:
    fixture = FIXTURE.read_text(encoding="utf-8")
    if not SIGNATURE.search(fixture):
        print(f"Payload detector fixture did not match: {FIXTURE}", file=sys.stderr)
        return 1

    tracked = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    findings = []
    for raw_path in tracked:
        if not raw_path:
            continue
        path = Path(raw_path.decode())
        if (
            path in {FIXTURE, WORKFLOW}
            or not path.is_file()
            or not is_scanned_file(path)
        ):
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        for match in SIGNATURE.finditer(content):
            line = content.count("\n", 0, match.start()) + 1
            findings.append(f"{path}:{line}: PolinRider payload signature")

    if findings:
        print("\n".join(findings), file=sys.stderr)
        return 1
    print("No PolinRider payload signatures found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
