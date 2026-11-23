"""Build a WorkBuddy import ZIP with vendor metadata and SKILL.md at ZIP root."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def build(output: Path) -> dict:
    root = Path(__file__).resolve().parents[1]
    source = (root / "SKILL.md").read_text(encoding="utf-8")
    _, header, body = source.split("---", 2)
    base = dict(line.split(":", 1) for line in header.strip().splitlines())
    fields = {"name": base["name"].strip(), "description": base["description"].strip()}
    fields.update(json.loads((root / "workbuddy-metadata.json").read_text(encoding="utf-8")))
    required = ["name", "description", "display_name", "display_name_en", "description_zh", "description_en", "version", "author"]
    if any(not isinstance(fields.get(key), str) or not fields[key].strip() for key in required):
        raise ValueError("WorkBuddy required metadata is missing")
    output = output.resolve()
    if output.suffix.lower() != ".zip" or output.is_relative_to(root):
        raise ValueError("Choose a ZIP output outside the skill source directory")
    packaged = "---\n" + "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in fields.items()) + "\n---\n" + body.lstrip("\r\n")
    resources = ["references/deployment.md", "scripts/configure-workbuddy.mjs", "scripts/install-codebuddy.mjs", "scripts/login-codebuddy.mjs", "scripts/verify-source.mjs"]
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        # The downloadable package should reproduce across checkout times and platforms.
        for name in ["SKILL.md", *resources]:
            content = packaged if name == "SKILL.md" else (root / name).read_text(encoding="utf-8")
            entry = ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content.encode("utf-8"), compress_type=ZIP_DEFLATED)
    with ZipFile(output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {"SKILL.md", *resources}
    return {"output": str(output), "files": len(resources) + 1, "workbuddy_metadata": True, "skill_at_zip_root": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(json.dumps(build(parser.parse_args().output), ensure_ascii=False))
