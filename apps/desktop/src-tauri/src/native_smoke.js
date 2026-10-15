setTimeout(async()=>{const invoke=window.__TAURI_INTERNALS__.invoke;const checks=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));const assert=(condition,message)=>{if(!condition)throw new Error(message);};const site=__SMOKE_SITE__;const label='browser-'+crypto.randomUUID();const savedAppearance=['obryth.appearance.v1','obryth.theme','obryth.terminal.appearance.v1'].map(key=>[key,localStorage.getItem(key)]);const restoreAppearance=()=>savedAppearance.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));const until=async(condition,message)=>{for(let attempt=0;attempt<100;attempt++){if(condition())return;await sleep(50);}throw new Error(message);};try{
 await invoke('native_smoke_progress',{phase:'JS started'});
 const chrome=await invoke('native_smoke_chrome');if(chrome.macos){assert(chrome.style==='Overlay'&&chrome.hiddenTitle,'macOS titlebar is not integrated');assert(parseFloat(getComputedStyle(document.querySelector('.macos-native .app-titlebar')).paddingLeft)>=90,'traffic light clearance is missing');assert(document.querySelector('.app-titlebar').getBoundingClientRect().height===46,'toolbar height is inconsistent');assert(chrome.trafficLights.y===25,'traffic light vertical inset is incorrect');assert(document.querySelector('.app-titlebar').getBoundingClientRect().top===0,'application toolbar does not start at the top');assert(Math.abs(chrome.outerHeight-window.innerHeight)<3,'native titlebar still consumes an extra row');checks.push('macOS overlay titlebar, traffic-light clearance and full-height content');}

 if(chrome.macos){
  assert(chrome.transparent,'native material requires a transparent WebView');
  document.querySelector('[aria-label="外观设置"]').click();
  await until(()=>document.querySelector('.appearance-options'),'appearance settings did not open');
  const choose=label=>[...document.querySelectorAll('.appearance-options button')].find(button=>button.querySelector('span').textContent===label).click();
  choose('自动');
  if(!matchMedia('(prefers-reduced-transparency: reduce)').matches&&!matchMedia('(prefers-contrast: more)').matches){
   await until(()=>document.documentElement.dataset.nativeMaterial==='true','native glass IPC did not complete');
   choose('实色');await until(()=>document.documentElement.dataset.nativeMaterial==='false','native glass did not clear');
   choose('Liquid Glass');await until(()=>document.documentElement.dataset.nativeMaterial==='true','native glass did not reapply');
   choose('深色');await until(()=>document.documentElement.dataset.theme==='dark'&&document.documentElement.dataset.nativeMaterial==='true','dark glass did not apply');
   choose('浅色');await until(()=>document.documentElement.dataset.theme==='light'&&document.documentElement.dataset.nativeMaterial==='true','light glass did not apply');
   checks.push('native Liquid Glass / Sidebar material IPC, solid fallback, light and dark palettes');
  }else checks.push('native material respects reduced transparency / increased contrast');
  document.querySelector('[aria-label="关闭设置"]').click();
 }

 const info=await invoke('rpc',{method:'vault.info',params:{}});assert(info.protocolVersion===1,'note service unavailable');checks.push('Tauri IPC → detached note service');const saved=await invoke('rpc',{method:'notes.save',params:{title:'Native activity fixture',body:'Native history',kind:'memo'}});const year=new Date().getUTCFullYear();const range={from:year+'-01-01',to:(year+1)+'-01-01',timeZone:'UTC',kind:null};const activity=await invoke('rpc',{method:'notes.activity',params:range});assert(activity.totalSaves===1,'native activity count incorrect');const feed=await invoke('rpc',{method:'notes.activityFeed',params:{range,cursor:null,limit:20,noteId:null}});assert(feed.items[0].note.body==='Native history','native feed snapshot missing');await until(()=>document.querySelector('.activity-card'),'native activity card did not render');assert(!document.querySelector('.note-index')?.getBoundingClientRect().width,'home should hide the index');assert(!document.querySelector('.note-inspector'),'home should hide the inspector');checks.push('native activity RPC, revision snapshot, homepage card and contextual layout');await invoke('native_smoke_progress',{phase:'note service connected'});
 const host=new URL(site).hostname;await invoke('browser_script',{host,code:`document.addEventListener('DOMContentLoaded',()=>{document.body.append(' user-script-ok');if(!globalThis.__TAURI_INTERNALS__){document.body.append(' native-access-denied');}else globalThis.__TAURI_INTERNALS__.invoke('rpc',{method:'notes.save',params:{title:'UNTRUSTED_WRITE',body:'bad'}}).then(()=>document.body.append(' native-access-allowed')).catch(()=>document.body.append(' native-access-denied'));});`});
 const navigationStates=[];const navigationCallback=window.__TAURI_INTERNALS__.transformCallback(event=>navigationStates.push(event.payload));const navigationListener=await invoke('plugin:event|listen',{event:'obryth-browser-state',target:{kind:'Any'},handler:navigationCallback});
 const bounds={x:300,y:180,width:700,height:450,visible:true};await invoke('native_smoke_progress',{phase:'creating child'});await invoke('browser_create',{label,url:site,bounds});await invoke('native_smoke_progress',{phase:'child created'});await sleep(1800);const clip=await invoke('browser_action',{label,action:'clip'});assert(clip.body.includes('native-smoke-page'),'child WebView did not load fixture');assert(clip.body.includes('user-script-ok'),'site script did not execute');assert(clip.body.includes('native-access-denied'),'external view obtained native authority');checks.push('native child WebView, site script and privilege boundary');
 await invoke('browser_bounds',{label,bounds:{...bounds,visible:false}});await invoke('browser_bounds',{label,bounds:{...bounds,width:540,height:320,visible:true}});checks.push('native child visibility and geometry');
 const imports=await invoke('browser_imports');assert(imports.length>0,'encrypted cookie queue missing');const imported=await invoke('browser_import',{label,id:imports[0].id});assert(imported.imported===1&&imported.skipped===1,'cookie import counters wrong');await invoke('browser_navigate',{label,url:site+'/cookies'});await sleep(1200);const cookies=await invoke('browser_action',{label,action:'clip'});assert(cookies.body.includes('fixture-session'),'imported cookie was not sent by WebView');checks.push('native Cookie API, partition skip and browser login state');
 assert(navigationStates.some(state=>state.label===label&&state.url===site+'/cookies'&&state.title==='Native smoke'),'native browser navigation did not update page metadata');checks.push('native page title and navigation metadata reach application');await invoke('plugin:event|unlisten',{event:'obryth-browser-state',eventId:navigationListener});window.__TAURI_INTERNALS__.unregisterCallback(navigationCallback);
 await invoke('browser_close',{label});
 const session=await invoke('rpc',{method:'agent.terminal.create',params:{title:'Channel fixture',workspace:info.root,size:{cols:80,rows:24}}});
 const streamId=crypto.randomUUID(),received=[];const callback=window.__TAURI_INTERNALS__.transformCallback(raw=>{if(raw.message)received.push(raw.message);});
 await invoke('terminal_watch',{id:session.id,streamId,afterSeq:0,channel:'__CHANNEL__:'+callback});await until(()=>received.length>0,'terminal channel did not deliver its first page');assert(received.length===1,'channel should have exactly one unacknowledged page');
 await invoke('rpc',{method:'agent.terminal.input',params:{id:session.id,dataB64:btoa("printf 'channel-%s-ok\\n' 'smoke'\r")}});await sleep(250);assert(received.length===1,'terminal producer ignored backpressure');let output='';
 for(let attempt=0;attempt<15;attempt++){for(const entry of received.splice(0)){if(entry.type==='error')throw new Error(entry.message);for(const event of entry.page.events)if(event.type==='output')output+=atob(event.dataB64);await invoke('terminal_ack',{streamId});}if(output.includes('channel-smoke-ok'))break;await sleep(200);}assert(output.includes('channel-smoke-ok'),'channel did not resume after acknowledgement');await invoke('terminal_unwatch',{streamId});await invoke('rpc',{method:'agent.terminal.close',params:{id:session.id}});window.__TAURI_INTERNALS__.unregisterCallback(callback);checks.push('real Tauri terminal Channel with ACK backpressure');

 await until(()=>document.querySelector('.home-pane'),'default home did not render');
 assert(document.querySelector('.home-capture textarea'),'home quick capture is missing');
 checks.push('default home renders in native WebView');
 localStorage.setItem('obryth.terminal.appearance.v1',JSON.stringify({theme:'glass',font:'mono',fontSize:13}));
 window.dispatchEvent(new Event('obryth:terminal-appearance'));
 [...document.querySelectorAll('[aria-label="终端工作区"]')].find(button=>button.getBoundingClientRect().width>0).click();
 await until(()=>document.querySelector('.terminal-pane .primary-button'),'terminal launch button missing');
 document.querySelector('.terminal-pane .primary-button').click();
 await until(()=>document.querySelector('.terminal-pane .xterm'),'xterm did not mount');
 const terminalNode=document.querySelector('.terminal-pane .xterm');
 const terminalSessions=await invoke('rpc',{method:'agent.sessions',params:{limit:50}});
 const uiSession=terminalSessions.items.find(session=>session.kind==='pty'&&session.title==='Shell');
 assert(uiSession,'terminal UI did not create a real PTY');
 await invoke('rpc',{method:'agent.terminal.input',params:{id:uiSession.id,dataB64:btoa("printf '\\033[31mglass-%s-ok\\033[0m\\n' 'smoke'\r")}});
 await until(()=>document.querySelector('.xterm-rows')?.textContent.includes('glass-smoke-ok'),'xterm did not render real PTY output');
 assert([...document.fonts].some(font=>font.family.replaceAll('"','')==='JetBrains Mono'&&font.status==='loaded'),'bundled JetBrains Mono did not load under production CSP');
 for(const theme of ['midnight','nord','forest','paper','system','glass']){
  const select=document.querySelector('.terminal-pane [aria-label="终端主题"]');
  select.value=theme;select.dispatchEvent(new Event('change',{bubbles:true}));
  await until(()=>document.querySelector('.terminal-pane').dataset.terminalTheme===theme,'terminal theme did not update: '+theme);
  assert(document.querySelector('.terminal-pane .xterm')===terminalNode,'changing theme recreated the terminal');
  assert(document.querySelector('.xterm-rows').textContent.includes('glass-smoke-ok'),'theme switch lost output');
 }
 localStorage.setItem('obryth.terminal.appearance.v1',JSON.stringify({theme:'glass',font:'nerd',fontSize:16}));
 window.dispatchEvent(new Event('obryth:terminal-appearance'));
 await until(()=>getComputedStyle(document.querySelector('.xterm-rows')).fontSize==='16px','font resize did not reach xterm');
 assert(document.querySelector('.terminal-pane .xterm')===terminalNode,'changing font recreated the terminal');
 assert([...document.fonts].some(font=>font.family.replaceAll('"','')==='JetBrains Mono Nerd'&&font.status==='loaded'),'bundled Nerd Font failed to load');
 await invoke('rpc',{method:'agent.terminal.close',params:{id:uiSession.id}});
 checks.push('real xterm PTY output, six live themes, bundled Mono/Nerd fonts and font resize without recreating session');
 const workerResult=await new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob(["postMessage({window:typeof window,bridge:typeof globalThis.__TAURI_INTERNALS__})"],{type:'application/javascript'}));const worker=new Worker(url);worker.onmessage=event=>{worker.terminate();URL.revokeObjectURL(url);resolve(event.data)};worker.onerror=reject;});assert(workerResult.window==='undefined'&&workerResult.bridge==='undefined','plugin worker has application authority');checks.push('plugin Worker runs under production CSP without native bridge');
 restoreAppearance();await invoke('native_smoke_report',{report:{ok:true,checks}});
}catch(error){restoreAppearance();await invoke('native_smoke_report',{report:{ok:false,checks,error:String(error)}});}},1000);
