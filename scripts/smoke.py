#!/usr/bin/env python3
"""Exercise the real CLI, authenticated note service, WebDAV, MCP and optional Prospero PTY."""
import argparse, base64, concurrent.futures, contextlib, http.server, json, os, pathlib, signal, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
parser=argparse.ArgumentParser();parser.add_argument('--binary',default='target/debug/obryth');parser.add_argument('--prospero');args=parser.parse_args()
binary=str(pathlib.Path(args.binary).resolve());env={**os.environ,'OBRYTH_TEST_DAV_PASSWORD':'fixture-password','OBRYTH_TEST_API_KEY':'fixture-key'}
if args.prospero:env['OBRYTH_PROSPERO_BIN']=str(pathlib.Path(args.prospero).resolve())
checks=[];vaults=[]
with tempfile.TemporaryDirectory(prefix='obryth-smoke-') as temp:
 root=pathlib.Path(temp);objects={};collections=set();requests=[]
 class Server(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def reply(self,status=200,body=b'',content_type='application/json'):
   self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  def auth(self):return self.headers.get('Authorization')=='Basic '+base64.b64encode(b'fixture:fixture-password').decode()
  def do_MKCOL(self):
   if not self.auth():return self.reply(401)
   if self.path in collections:return self.reply(405)
   collections.add(self.path);self.reply(201)
  def do_PROPFIND(self):
   if not self.auth():return self.reply(401)
   paths=[self.path]+[key for key in objects if key.startswith(self.path)]
   body=('<d:multistatus xmlns:d="DAV:">'+''.join('<d:response><d:href>'+key+'</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>' for key in paths)+'</d:multistatus>').encode();self.reply(207,body,'application/xml')
  def do_PUT(self):
   if not self.auth():return self.reply(401)
   objects[self.path]=self.rfile.read(int(self.headers['Content-Length']));requests.append(('PUT',self.path));self.reply(201)
  def do_GET(self):
   if self.path=='/v1/models':return self.reply(200,json.dumps({'data':[{'id':'fixture-model'}]}).encode())
   if not self.auth():return self.reply(401)
   if self.path not in objects:return self.reply(404)
   self.reply(200,objects[self.path],'application/octet-stream')
  def do_POST(self):
   payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
   assert self.headers.get('Authorization')=='Bearer fixture-key'
   if self.path=='/v1/embeddings':
    requests.append(('EMBED',self.path));return self.reply(200,json.dumps({'data':[{'index':i,'embedding':[1,0.5,0.25]} for i,_ in enumerate(payload['input'])]}).encode())
   assert self.path=='/v1/chat/completions';assert 'Sources (JSON)' in payload['messages'][1]['content'];self.reply(200,json.dumps({'choices':[{'message':{'content':'Fixture answer with note citations.'}}]}).encode())
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Server);threading.Thread(target=server.serve_forever,daemon=True).start();endpoint=f'http://127.0.0.1:{server.server_port}'
 def cli(vault,*command,input=None,success=True):
  if vault not in vaults:vaults.append(vault)
  result=subprocess.run([binary,'--vault',str(vault),*command],input=input,text=True,capture_output=True,env=env,timeout=40)
  if success and result.returncode:raise AssertionError(f'{command[0]}: {result.stderr}')
  return result
 def rpc(vault,method,params={}):return json.loads(cli(vault,'rpc',method,json.dumps(params)).stdout)
 try:
  a=root/'a';b=root/'b';cli(a,'init');note=json.loads(cli(a,'rpc','notes.save',json.dumps({'title':'Smoke 中文','body':'WebDAV and terminal notes','tags':['dev']})).stdout)
  assert rpc(a,'notes.get',{'id':note['id']})['body']=='WebDAV and terminal notes'
  assert len(json.loads(cli(a,'search','WebDAV','--json').stdout))==1
  connection=json.loads((a/'.obryth/connection.json').read_text())
  try:urllib.request.urlopen(urllib.request.Request(connection['url']+'/rpc',data=b'{"method":"notes.list","params":{}}',headers={'Content-Type':'application/json'}));raise AssertionError('unauthenticated request was accepted')
  except urllib.error.HTTPError as error:assert error.code==401
  checks.append('authenticated headless service and CLI JSON')
  pairing=root/'pairing.json';cli(a,'pairing','--output',str(pairing));cli(b,'join',str(pairing))
  sync={'endpoint':endpoint+'/dav/','username':'fixture','secretRef':'env:OBRYTH_TEST_DAV_PASSWORD'}
  rpc(a,'sync.run',sync);rpc(b,'sync.run',sync);assert rpc(b,'notes.get',{'id':note['id']})['title']=='Smoke 中文';assert all(b'WebDAV and terminal notes' not in value for value in objects.values());checks.append('encrypted WebDAV PUT/PROPFIND/GET and pairing')
  proposal=rpc(a,'knowledge.propose',{'noteId':note['id'],'baseRevision':note['revision'],'body':'reviewed'})
  assert rpc(a,'notes.get',{'id':note['id']})['body']!='reviewed';rpc(a,'knowledge.review',{'id':proposal['id'],'accept':True});assert rpc(a,'notes.get',{'id':note['id']})['body']=='reviewed';checks.append('proposal review and revision checks')
  private=rpc(a,'notes.save',{'title':'Private','body':'private','tags':['private']})
  messages=[{'jsonrpc':'2.0','id':1,'method':'initialize'},{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'read_note','arguments':{'id':private['id']}}},{'jsonrpc':'2.0','id':3,'method':'tools/list'}]
  result=cli(a,'mcp','--tag','dev',input='\n'.join(json.dumps(item) for item in messages)+'\n');responses=[json.loads(line) for line in result.stdout.splitlines()];assert len(responses)==3 and responses[1]['result']['isError'];checks.append('MCP scope rejection keeps the server alive')
  profile={'id':'fixture','name':'Fixture','protocol':'openai-compatible','endpoint':endpoint+'/v1','models':['fixture-model'],'secretRef':'env:OBRYTH_TEST_API_KEY','purpose':'chat'}
  rpc(a,'providers.save',{'profile':profile});assert rpc(a,'providers.models',{'profile':profile})==['fixture-model']
  chat=rpc(a,'chat.create',{'title':'Smoke chat','providerId':'fixture','model':'fixture-model'})
  assert 'Fixture answer' in rpc(a,'knowledge.ask',{'profileId':'fixture','model':'fixture-model','conversationId':chat['id'],'question':'reviewed','scope':{'includeTags':['dev']}})['answer']
  history=rpc(a,'chat.history',{'id':chat['id']});assert len(history)==2 and history[1]['citations'][0]['noteId']==note['id'];checks.append('API conversation persists versioned note citations')
  rpc(a,'knowledge.index',{'profileId':'fixture','model':'fixture-model'});count=len([r for r in requests if r[0]=='EMBED']);assert count>0
  assert rpc(a,'knowledge.index',{'profileId':'fixture','model':'fixture-model'})['indexed']==0;assert len([r for r in requests if r[0]=='EMBED'])==count
  assert rpc(a,'knowledge.semantic',{'profileId':'fixture','model':'fixture-model','query':'anything','scope':{'excludeTags':['private']}});checks.append('API provider, scoped RAG and incremental embedding API')
  capture=cli(a,'capture','--title','Command failure','--',sys.executable,'-c','print("capture-ok");raise SystemExit(7)',success=False);assert capture.returncode==7;captured=json.loads(cli(a,'search','capture-ok','--json').stdout);assert captured and captured[0]['note']['kind']=='runbook';checks.append('command capture preserves stdout and exit code')
  cookies=json.dumps({'url':'https://example.com','cookies':[{'name':'session','value':'fixture-cookie-secret','domain':'.example.com','path':'/','secure':True}]}).encode();native=subprocess.run([binary,'--vault',str(a),'browser-bridge'],input=len(cookies).to_bytes(4,'little')+cookies,capture_output=True,env=env,timeout=10);reply=json.loads(native.stdout[4:]);assert reply['ok'];assert b'fixture-cookie-secret' not in next((a/'.obryth/browser-imports').glob('*.enc')).read_bytes();checks.append('Native Messaging queues encrypted site imports')
  if args.prospero:
   def create_terminal(index):return rpc(a,'agent.terminal.create',{'title':f'Smoke PTY {index}','workspace':str(root),'size':{'cols':100,'rows':30}})
   with concurrent.futures.ThreadPoolExecutor(max_workers=4)as executor:sessions=list(executor.map(create_terminal,range(4)))
   assert len(set(session['id']for session in sessions))==4
   for index,session in enumerate(sessions):rpc(a,'agent.terminal.input',{'id':session['id'],'dataB64':base64.b64encode(f"printf 'obryth-%s-{index}-ok\\n' 'pty'\r".encode()).decode()})
   for index,session in enumerate(sessions):
    sid=session['id'];seq=0;output=b'';marker=f'obryth-pty-{index}-ok'.encode()
    for _ in range(30):
     page=rpc(a,'agent.terminal.output',{'id':sid,'afterSeq':seq,'waitMs':300});seq=page['nextSeq'];output+=b''.join(base64.b64decode(event['dataB64']) for event in page['events'] if event['type']=='output')
     if marker in output:break
    assert marker in output,output[-1000:];rpc(a,'agent.terminal.resize',{'id':sid,'size':{'cols':80,'rows':24}});assert rpc(a,'agent.terminal.snapshot',{'id':sid}) is not None;rpc(a,'agent.terminal.close',{'id':sid})
   log=(a/'.obryth/prospero/obryth-runtime.log').read_text();assert log.count('"event":"ready"')==1,log
   checks.append('four concurrent Prospero PTYs, single runtime startup, resize and snapshot')
  print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
 finally:
  if sys.exc_info()[0]:
   logs=[path for vault in vaults for path in [vault/'.obryth/service.log',vault/'.obryth/prospero/obryth-runtime.log'] if path.exists()]
   details='\n'.join(str(path.relative_to(root))+':\n'+path.read_text(errors='replace')[-5000:]for path in logs)
   pathlib.Path('artifacts').mkdir(exist_ok=True);pathlib.Path('artifacts/smoke-failure.log').write_text(details)
  server.shutdown()
  for vault in vaults:
   for descriptor in [vault/'.obryth/connection.json',vault/'.obryth/prospero/connection.json']:
    if descriptor.exists():
     with contextlib.suppress(ProcessLookupError,PermissionError):os.kill(json.loads(descriptor.read_text())['pid'],signal.SIGTERM)
  deadline=time.monotonic()+8
  while any((vault/'.obryth/prospero/connection.json').exists()for vault in vaults)and time.monotonic()<deadline:time.sleep(.05)
  time.sleep(.15) # Let the daemon finish its final database close before removing fixtures.
