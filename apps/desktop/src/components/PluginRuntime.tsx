import { useEffect, useRef, useState } from "react";
import { validateManifest, type PluginManifest } from "@obryth/plugin-sdk";
import type { IDockviewPanelProps } from "dockview-react";
import { bridge, safeMessage } from "../lib/bridge";
import { useWorkbench } from "../lib/workbench";
export type PluginCommand = { id: string; title: string; run: () => void };
function program(code: string, manifest: PluginManifest) {
  return (
    code +
    `\n;const commands=new Map(),pending=new Map();let seq=0;
 function call(method,params){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});postMessage({obryth:true,id,method,params});});}
 onmessage=event=>{const m=event.data;if(m.resultId){const p=pending.get(m.resultId);if(p){pending.delete(m.resultId);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}}if(m.command)Promise.resolve(commands.get(m.command)?.()).catch(error=>call('notify',{message:String(error)}));};
 const context={manifest:${JSON.stringify(manifest)},registerCommand:c=>{commands.set(c.id,c.run);call('command',{id:c.id,title:c.title});return()=>commands.delete(c.id);},search:async(query,scope)=>(await call('search',{text:query,scope})).map(hit=>hit.note),propose:async(noteId,baseRevision,body)=>(await call('propose',{noteId,baseRevision,body})).id,notify:message=>call('notify',{message}),fetch:url=>call('fetch',{url}),registerPanel:panel=>call('panel',panel),openPanel:id=>call('openPanel',{id})};Promise.resolve(globalThis.ObrythPlugin?.activate(context)).catch(error=>context.notify(String(error)));`
  );
}
/** Workers have no DOM, Tauri bridge or credential storage. Only these declared SDK calls cross the boundary. */
export function PluginRuntime({
  onCommands,
  onPanel,
}: {
  onCommands: (commands: PluginCommand[]) => void;
  onPanel: (id: string, title: string, html: string) => void;
}) {
  const workbench = useWorkbench();
  const [epoch, setEpoch] = useState(0);
  const callbacks = useRef({ onCommands, onPanel, notify: workbench.notify });
  callbacks.current = { onCommands, onPanel, notify: workbench.notify };
  useEffect(() => {
    const reload = () => setEpoch((n) => n + 1);
    window.addEventListener("obryth:plugins-changed", reload);
    return () => window.removeEventListener("obryth:plugins-changed", reload);
  }, []);
  useEffect(() => {
    let active = true;
    const workers: Worker[] = [];
    const urls: string[] = [];
    const commands: PluginCommand[] = [];
    void (async () => {
      const [plugins, enabled] = await Promise.all([
        bridge.call<{ manifest: PluginManifest; code: string }[]>(
          "plugins.list",
        ),
        bridge.call<string[] | null>("settings.get", {
          key: "plugins.enabled",
        }),
      ]);
      if (!active) return;
      for (const plugin of plugins) {
        const manifest = validateManifest(plugin.manifest);
        if (
          !enabled?.includes(manifest.id) ||
          !manifest.platforms.includes("desktop")
        )
          continue;
        const url = URL.createObjectURL(
          new Blob([program(plugin.code, manifest)], {
            type: "application/javascript",
          }),
        );
        urls.push(url);
        const worker = new Worker(url);
        workers.push(worker);
        const panels = new Map<string, { title: string; html: string }>();
        const permissions = new Set(manifest.permissions);
        worker.onmessage = (event) => {
          if (!event.data?.obryth || !active) return;
          const { id, method, params } = event.data;
          void (async () => {
            let result: unknown = true;
            const require = (permission: string) => {
              if (!permissions.has(permission as never))
                throw new Error(`Plugin permission required: ${permission}`);
            };
            switch (method) {
              case "command":
                require("commands");
                commands.push({
                  id: `${manifest.id}.${params.id}`,
                  title: String(params.title),
                  run: () => worker.postMessage({ command: params.id }),
                });
                callbacks.current.onCommands([...commands]);
                break;
              case "search":
                require("notes.read");
                result = await bridge.call("knowledge.search", {
                  ...params,
                  limit: 100,
                });
                break;
              case "propose":
                require("notes.propose");
                result = await bridge.call("knowledge.propose", params);
                break;
              case "fetch":
                require("network");
                result = await bridge.call("plugins.fetch", {
                  pluginId: manifest.id,
                  url: params.url,
                });
                break;
              case "notify":
                callbacks.current.notify(String(params.message).slice(0, 4000));
                break;
              case "panel":
                require("panels");
                if (String(params.html).length > 1024 * 1024)
                  throw new Error("Panel exceeds 1 MiB");
                panels.set(String(params.id), {
                  title: String(params.title),
                  html: String(params.html),
                });
                break;
              case "openPanel": {
                require("panels");
                const panel = panels.get(String(params.id));
                if (!panel) throw new Error("Panel was not registered");
                callbacks.current.onPanel(
                  `${manifest.id}.${params.id}`,
                  panel.title,
                  panel.html,
                );
                break;
              }
              default:
                throw new Error("Plugin method not supported");
            }
            worker.postMessage({ resultId: id, result });
          })().catch((error) =>
            worker.postMessage({ resultId: id, error: safeMessage(error) }),
          );
        };
        worker.onerror = (error) =>
          callbacks.current.notify(`${manifest.name}: ${error.message}`);
      }
    })().catch(() => {});
    return () => {
      active = false;
      workers.forEach((worker) => worker.terminate());
      urls.forEach((url) => URL.revokeObjectURL(url));
      callbacks.current.onCommands([]);
    };
  }, [epoch]);
  return null;
}
export function PluginPane(props: IDockviewPanelProps<{ html: string }>) {
  return (
    <iframe
      title={props.api.title}
      sandbox=""
      srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';img-src data:;base-uri 'none';form-action 'none'"><style>body{font:14px system-ui;padding:25px;color:#40523a}</style>${props.params.html}`}
      style={{ width: "100%", height: "100%", border: 0 }}
    />
  );
}
