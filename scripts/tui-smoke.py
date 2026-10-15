#!/usr/bin/env python3
"""Exercise the real TUI in a controlling POSIX terminal, including Unicode drafts."""
import argparse
import contextlib
import fcntl
import json
import os
import pathlib
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument('--binary', default='target/debug/obryth')
args = parser.parse_args()
binary = str(pathlib.Path(args.binary).resolve())
with tempfile.TemporaryDirectory(prefix='obryth-tui-') as directory:
    root = pathlib.Path(directory)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 64, 0, 0))

    def controlling_terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    app = subprocess.Popen([binary, '--vault', str(root), 'tui'], stdin=slave,
                           stdout=slave, stderr=slave, preexec_fn=controlling_terminal,
                           env={**os.environ, 'TERM': 'xterm-256color'})
    os.close(slave)
    transcript = bytearray()

    def wait_for(value, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if value in transcript:
                return
            if select.select([master], [], [], .1)[0]:
                data = os.read(master, 65536)
                transcript.extend(data)
                if b'\x1b[6n' in data:
                    os.write(master, b'\x1b[1;1R')
            if app.poll() is not None:
                break
        raise AssertionError(f'TUI did not render {value!r}: {transcript[-2000:]!r}')

    def rpc(method, params):
        result = subprocess.run([binary, '--vault', str(root), 'rpc', method,
                                 json.dumps(params)], capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    try:
        wait_for(b'OBRYTH')
        os.write(master, b'n')
        wait_for(b'EDIT')
        os.write(master, '终端草稿 hello'.encode())
        wait_for('稿'.encode())
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            drafts = list((root / '.obryth/drafts').glob('*.json'))
            if drafts and json.loads(drafts[0].read_text())['body'] == '终端草稿 hello':
                break
            time.sleep(.02)
        else:
            raise AssertionError('Unicode input did not reach the recovery draft')
        os.write(master, b'\x1b')
        wait_for(b'Draft kept')
        os.write(master, b'e')
        time.sleep(.2)
        os.write(master, b'\x13')
        wait_for(b'Saved')
        notes = rpc('notes.list', {'limit': 10})
        assert notes[0]['note']['body'] == '终端草稿 hello'
        assert not list((root / '.obryth/drafts').glob('*.json'))
        transcript.clear()
        os.write(master, b'/')
        wait_for(b'earch:')  # Ratatui can retain the existing S in Saved.
        os.write(master, b'hello\r')
        # Drain output while the search request completes and before quitting.
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            if select.select([master], [], [], .1)[0]:
                transcript.extend(os.read(master, 65536))
        os.write(master, b'q')
        deadline = time.monotonic() + 5
        while app.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], .1)[0]:
                with contextlib.suppress(OSError):
                    transcript.extend(os.read(master, 65536))
        assert app.poll() is not None, transcript[-2000:]
        assert app.returncode == 0
        print(json.dumps({'ok': True, 'checks': ['64-column TUI without GUI',
              'Unicode capture and draft recovery', 'Ctrl+S persists Markdown',
              'search and clean terminal restoration']}, indent=2))
    finally:
        if app.poll() is None:
            app.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                app.wait(timeout=5)
        os.close(master)
        descriptor = root / '.obryth/connection.json'
        if descriptor.exists():
            with contextlib.suppress(ProcessLookupError):
                os.kill(json.loads(descriptor.read_text())['pid'], signal.SIGTERM)
