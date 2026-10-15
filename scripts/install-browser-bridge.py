#!/usr/bin/env python3
"""Install a native messaging manifest for a user-selected unpacked extension ID."""
import argparse, json, os, pathlib, platform, re, shlex, sys
parser=argparse.ArgumentParser()
parser.add_argument('--extension-id',required=True)
parser.add_argument('--executable',type=pathlib.Path,required=True,help='Absolute obryth CLI or desktop executable')
parser.add_argument('--vault',type=pathlib.Path,default=pathlib.Path.home()/'Obryth')
parser.add_argument('--browser',choices=['chrome','edge'],default='chrome')
parser.add_argument('--output',type=pathlib.Path,help='Generate files here without registering the manifest')
args=parser.parse_args()
if not re.fullmatch('[a-p]{32}',args.extension_id):parser.error('extension ID must have 32 letters a–p')
executable=args.executable.resolve(strict=True)
root=args.vault.expanduser().resolve()
if platform.system()=='Windows':
    parser.error('On Windows build obryth-browser-bridge.exe, then register the manifest in HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.obryth.browser_bridge (or Microsoft\\Edge). See docs/browser.md.')
location=args.output
if location is None:
    if platform.system()=='Darwin':location=pathlib.Path.home()/'Library/Application Support'/('Google/Chrome' if args.browser=='chrome' else 'Microsoft Edge')/'NativeMessagingHosts'
    else:location=pathlib.Path.home()/('.config/google-chrome' if args.browser=='chrome' else '.config/microsoft-edge')/'NativeMessagingHosts'
location.mkdir(parents=True,exist_ok=True)
wrapper=location/'obryth-browser-bridge'
wrapper.write_text('#!/bin/sh\nexec '+shlex.quote(str(executable))+' --vault '+shlex.quote(str(root))+' browser-bridge "$@"\n')
wrapper.chmod(0o700)
manifest=location/'app.obryth.browser_bridge.json'
manifest.write_text(json.dumps({'name':'app.obryth.browser_bridge','description':'Obryth site cookie import bridge','path':str(wrapper),'type':'stdio','allowed_origins':['chrome-extension://'+args.extension_id+'/']},indent=2)+'\n')
manifest.chmod(0o600)
print(manifest)
