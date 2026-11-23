"""Create a local reviewable source bundle; never includes ignored user data or publishes."""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

def build(repo: Path, output: Path) -> dict:
    repo, output = repo.resolve(), output.resolve()
    if output.is_relative_to(repo) or output.suffix.lower() != '.zip' or output.exists():
        raise ValueError('Choose a new ZIP outside the repository')
    raw = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=repo)
    paths = sorted(set(raw.decode('utf-8').split('\0')) - {''})
    entries = []
    blocked = {'.git', '.local', '.venv', 'node_modules', '__pycache__', 'dist', '.aws', '.codex'}
    for name in paths:
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or blocked.intersection(relative.parts):
            continue
        if relative.name.startswith('.env') or relative.suffix.lower() in {'.pem', '.key', '.pfx', '.log', '.pyc'}:
            continue
        file = repo / relative
        if not file.exists():
            continue
        if file.is_symlink() or not file.resolve().is_relative_to(repo):
            raise ValueError(f'External link not bundled: {name}')
        if file.is_file():
            content = file.read_bytes()
            entries.append((relative.as_posix(), content))
    manifest = {'format': 1, 'product': 'Askill', 'release': False,
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in entries}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, 'x', ZIP_DEFLATED) as archive:
        for name, data in entries:
            archive.writestr('Askill/' + name, data)
        archive.writestr('Askill/source-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    with ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP verification failed')
        for name, expected in manifest['files'].items():
            if hashlib.sha256(archive.read('Askill/' + name)).hexdigest() != expected:
                raise ValueError(f'Hash mismatch: {name}')
    return {'output': str(output), 'files': len(entries), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'published': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(Path(__file__).resolve().parents[1], args.output), ensure_ascii=False))
