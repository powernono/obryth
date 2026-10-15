#!/usr/bin/env python3
"""Verify the macOS archives after extracting them outside the source tree."""
import argparse
import base64
import contextlib
import hashlib
import json
import os
import pathlib
import signal
import shutil
import statistics
import subprocess
import tarfile
import tempfile
import time
import urllib.request

project = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--fixture', type=pathlib.Path, help='Optional previously generated read benchmark vault')
args = parser.parse_args()
releases = project / 'artifacts/releases'
metadata = json.loads((releases / 'sizes.json').read_text())
for archive in metadata['archives']:
    assert hashlib.sha256((releases / archive['file']).read_bytes()).hexdigest() == archive['sha256']
with tempfile.TemporaryDirectory(prefix='obryth-package-smoke-') as directory:
    # Tauri deliberately rejects macOS executable paths containing symlinks;
    # Python's default /var temporary path is a symlink to /private/var.
    root = pathlib.Path(directory).resolve()
    gui = root / 'gui'
    gui.mkdir()
    zip_name = next(item['file'] for item in metadata['archives'] if item['file'].endswith('.zip'))
    subprocess.run(['ditto', '-x', '-k', str(releases / zip_name), str(gui)], check=True)
    app = gui / 'Obryth.app'
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    tar_name = next(item['file'] for item in metadata['archives'] if item['file'].endswith('.tar.gz'))
    with tarfile.open(releases / tar_name) as archive:
        for member in archive.getmembers():
            assert '..' not in pathlib.PurePosixPath(member.name).parts and not member.name.startswith('/')
            assert member.isfile() or member.isdir()
        archive.extractall(root)
    cli = next(root.glob('obryth-cli-*/obryth'))
    assert subprocess.run([str(cli), '--version'], capture_output=True, text=True, check=True).stdout.strip() == 'obryth 0.1.0'
    vault = root / 'vault'
    if args.fixture:
        shutil.copytree(args.fixture.resolve(), vault)
    env = {key: value for key, value in os.environ.items() if not key.startswith('OBRYTH_')}
    env['OBRYTH_VAULT'] = str(vault)
    log = (root / 'app.log').open('wb')
    process = subprocess.Popen([str(app / 'Contents/MacOS/obryth-desktop')], cwd=root, env=env, stdout=log, stderr=log)
    try:
        connection_path = vault / '.obryth/connection.json'
        deadline = time.monotonic() + 20
        while not connection_path.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(.1)
        assert connection_path.exists(), (root / 'app.log').read_text()
        connection = json.loads(connection_path.read_text())

        def rpc(method, params):
            request = urllib.request.Request(connection['url'] + '/rpc',
                data=json.dumps({'method': method, 'params': params}).encode(),
                headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + connection['token']})
            with urllib.request.urlopen(request, timeout=25) as response:
                result = json.load(response)
            assert 'error' not in result, result
            return result['result']

        info = rpc('vault.info', {})
        assert pathlib.Path(info['root']).resolve() == vault.resolve()
        session = rpc('agent.terminal.create', {'title': 'Packaged PTY', 'workspace': str(root), 'size': {'cols': 80, 'rows': 24}})
        rpc('agent.terminal.input', {'id': session['id'], 'dataB64': base64.b64encode(b"printf 'package-%s-ok\\n' 'smoke'\r").decode()})
        seq = 0
        output = b''
        for _ in range(30):
            page = rpc('agent.terminal.output', {'id': session['id'], 'afterSeq': seq, 'waitMs': 300})
            seq = page['nextSeq']
            output += b''.join(base64.b64decode(event['dataB64']) for event in page['events'] if event['type'] == 'output')
            if b'package-smoke-ok' in output:
                break
        assert b'package-smoke-ok' in output, output[-1500:]
        rpc('agent.terminal.close', {'id': session['id']})
        daemon = json.loads((vault / '.obryth/prospero/connection.json').read_text())
        samples = {name: [] for name in ['guiRust', 'noteService', 'prospero']}
        time.sleep(2)
        for _ in range(5):
            for name, pid in [('guiRust', process.pid), ('noteService', connection['pid']), ('prospero', daemon['pid'])]:
                measured = subprocess.run(['ps', '-p', str(pid), '-o', 'rss='], capture_output=True, text=True, check=True)
                samples[name].append(int(measured.stdout.strip()))
            time.sleep(.1)
        result = {'ok': True, 'checks': ['archive SHA256', 'extracted app signature', 'standalone CLI executable', 'embedded frontend launches note service', 'bundled Prospero works outside source tree'],
                  'memory': {'unit': 'KiB RSS', 'medianOf': 5, 'processes': {name: statistics.median(values) for name, values in samples.items()},
                             'fixture': str(args.fixture) if args.fixture else 'empty vault',
                             'state': 'GUI open after startup; one PTY created then closed; idle sampling',
                             'webview': 'XPC processes not attributed; excluded', 'externalAgent': 'not launched; excluded',
                             'total': 'not reported; RSS excludes WebView and shared pages cannot be summed'}}
        (project / 'artifacts/package-smoke.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
    finally:
        process.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=5)
        log.close()
        for path in [vault / '.obryth/connection.json', vault / '.obryth/prospero/connection.json']:
            if path.exists():
                with contextlib.suppress(ProcessLookupError):
                    os.kill(json.loads(path.read_text())['pid'], signal.SIGTERM)
        deadline = time.monotonic() + 8
        while (vault / '.obryth/prospero/connection.json').exists() and time.monotonic() < deadline:
            time.sleep(.05)
        time.sleep(.15)
