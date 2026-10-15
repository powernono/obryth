#!/usr/bin/env python3
"""Package already-built macOS artifacts; does not sign, publish or rebuild."""
import hashlib
import json
import pathlib
import platform
import shutil
import subprocess
import tarfile
import tempfile

project = pathlib.Path(__file__).resolve().parent.parent
version = json.loads((project / 'package.json').read_text())['version']
architecture = platform.machine()
if platform.system() != 'Darwin':
    raise SystemExit('This script packages native macOS builds only.')
destination = project / 'artifacts/releases'
destination.mkdir(parents=True, exist_ok=True)
app = project / 'target/release/bundle/macos/Obryth.app'
cli = project / 'target/release/obryth'
runtime = project / 'apps/desktop/src-tauri/binaries/prosperod-rs'
for path in (app, cli, runtime):
    if not path.exists():
        raise SystemExit(f'Build this artifact first: {path}')
if b'native_smoke_report' in (app / 'Contents/MacOS/obryth-desktop').read_bytes():
    raise SystemExit('Rebuild the standard app without the native-smoke feature before packaging.')
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
gui_archive = destination / f'Obryth-{version}-macos-{architecture}.zip'
if gui_archive.exists():
    gui_archive.unlink()
subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(gui_archive)], check=True)
cli_name = f'obryth-cli-{version}-macos-{architecture}'
cli_archive = destination / f'{cli_name}.tar.gz'
with tempfile.TemporaryDirectory(prefix='obryth-package-') as directory:
    bundle = pathlib.Path(directory) / cli_name
    bundle.mkdir()
    for source in (cli, runtime, project / 'LICENSE', project / 'THIRD_PARTY.md'):
        shutil.copy2(source, bundle / source.name)
    shutil.copy2(project / 'vendor/prospero/LICENSE', bundle / 'LICENSE.Prospero')
    (bundle / 'USAGE.txt').write_text(f'Obryth {version} development build (macOS {architecture}).\n\n'
        './obryth --vault ~/Obryth init\n./obryth tui\n./obryth terminal\n'
        './obryth capture --title "Test log" -- cargo test\n\n'
        'Keep prosperod-rs beside obryth for Agent/PTY features. Codex and other Agents are installed separately.\n'
        'No local model runtime is included. The note service runs independently of the TUI.\n'
        'This package is not Developer ID signed or notarized. See the repository docs/status.md for remaining work.\n')
    with tarfile.open(cli_archive, 'w:gz') as archive:
        archive.add(bundle, arcname=cli_name)
sizes = {
    'platform': f'macos-{architecture}',
    'version': version,
    'signing': 'development, no Developer ID/notarization',
    'appLogicalBytes': sum(p.stat().st_size for p in app.rglob('*') if p.is_file()),
    'cliBinaryBytes': cli.stat().st_size,
    'prosperoBinaryBytes': runtime.stat().st_size,
    'archives': [{
        'file': path.name, 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    } for path in (gui_archive, cli_archive)],
}
(destination / 'sizes.json').write_text(json.dumps(sizes, indent=2) + '\n')
(destination / 'SHA256SUMS').write_text(''.join(f"{item['sha256']}  {item['file']}\n" for item in sizes['archives']))
print(json.dumps(sizes, indent=2))
