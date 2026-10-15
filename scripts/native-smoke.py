#!/usr/bin/env python3
"""Run the feature-gated native WebView probe without OS UI automation."""
import base64,contextlib,http.server,json,os,pathlib,signal,subprocess,tempfile,threading,time
project=pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='obryth-native-')as temporary:
 root=pathlib.Path(temporary);report=root/'report.json';vault=root/'vault';binary=project/'target/release/obryth-desktop'
 class Fixture(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   body=('<html><head><title>Native smoke</title></head><body>native-smoke-page '+self.headers.get('Cookie','')+'</body></html>').encode();self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Fixture);threading.Thread(target=server.serve_forever,daemon=True).start();site=f'http://127.0.0.1:{server.server_port}'
 env={**os.environ,'OBRYTH_VAULT':str(vault),'OBRYTH_SMOKE_REPORT':str(report),'OBRYTH_SMOKE_SITE':site,'OBRYTH_PROSPERO_BIN':str(project/'apps/desktop/src-tauri/binaries/prosperod-rs')}
 cookies=[{'name':'obryth','value':'fixture-session','domain':'127.0.0.1','path':'/','secure':False,'sameSite':'lax'},{'name':'partition','value':'skip-me','domain':'127.0.0.1','path':'/','partitionKey':{'topLevelSite':site}}]
 message=json.dumps({'url':site,'cookies':cookies}).encode();queued=subprocess.run([str(binary),'browser-bridge'],input=len(message).to_bytes(4,'little')+message,env=env,capture_output=True,timeout=15);assert json.loads(queued.stdout[4:])['ok']
 with(root/'app.log').open('wb')as log:
  app=subprocess.Popen([str(binary)],env=env,stdout=log,stderr=log)
  try:
   deadline=time.monotonic()+45
   while not report.exists()and time.monotonic()<deadline and app.poll()is None:time.sleep(.2)
   if not report.exists():
    details='\n'.join(str(path.name)+': '+path.read_text(errors='replace')[-2500:] for path in [root/'app.log',vault/'.obryth/service.log'] if path.exists());(project/'artifacts/native-smoke-failure.log').write_text(details);raise RuntimeError('Native probe did not complete: '+details)
   result=json.loads(report.read_text());print(json.dumps(result,ensure_ascii=False,indent=2));(project/'artifacts').mkdir(exist_ok=True);(project/'artifacts/native-smoke.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');assert result['ok'],result
  finally:
   if app.poll()is None:app.terminate()
   with contextlib.suppress(subprocess.TimeoutExpired):app.wait(timeout=5)
   server.shutdown()
   for descriptor in [vault/'.obryth/connection.json',vault/'.obryth/prospero/connection.json']:
    if descriptor.exists():
     with contextlib.suppress(ProcessLookupError):os.kill(json.loads(descriptor.read_text())['pid'],signal.SIGTERM)
   deadline=time.monotonic()+8
   while(vault/'.obryth/prospero/connection.json').exists()and time.monotonic()<deadline:time.sleep(.05)
   time.sleep(.15)
