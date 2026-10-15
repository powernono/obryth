import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  Code2,
  FolderOpen,
  Plus,
  Puzzle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { PluginManifest } from "@obryth/plugin-sdk";
import { bridge, native, safeMessage } from "../lib/bridge";
const names: Record<string, string> = {
  "notes.read": "读取笔记",
  "notes.propose": "修改建议",
  commands: "注册命令",
  panels: "添加面板",
  network: "网络访问",
};
export function PluginSettings({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]),
    [enabled, setEnabled] = useState<string[]>([]),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [details, setDetails] = useState<string | null>(null);
  const load = async () => {
    setPlugins(
      (await bridge.call<{ manifest: PluginManifest }[]>("plugins.list")).map(
        (item) => item.manifest,
      ),
    );
    setEnabled(
      (await bridge.call<string[] | null>("settings.get", {
        key: "plugins.enabled",
      })) ?? [],
    );
  };
  useEffect(() => {
    void load().catch((error) => setError(safeMessage(error)));
  }, []);
  const changed = () =>
    window.dispatchEvent(new Event("obryth:plugins-changed"));
  const install = () =>
    void open({ directory: true, title: "选择 Obryth 插件文件夹" })
      .then(async (path) => {
        if (typeof path === "string") {
          await bridge.call("plugins.install", { path });
          await load();
          changed();
        }
      })
      .catch((error) => setError(safeMessage(error)));
  const list = plugins.filter(
    (plugin) =>
      (filter !== "enabled" || enabled.includes(plugin.id)) &&
      `${plugin.name} ${plugin.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className={
        standalone ? "management-page plugins-page" : "plugin-settings"
      }
    >
      <header className="management-header">
        <div className="page-breadcrumb">
          工作空间 <ChevronRight size={12} />
          扩展
        </div>
        <div className="page-heading">
          <div>
            <h1>插件与扩展</h1>
            <p>为你的工作方式，添加刚刚好的能力。</p>
          </div>
          <button
            className="primary-button"
            disabled={!native}
            onClick={install}
          >
            <Plus size={15} />
            安装本地插件
          </button>
        </div>
      </header>
      <div className="plugin-summary">
        <span className="plugin-summary-icon">
          <Puzzle size={23} />
        </span>
        <div>
          <h3>你的工作空间，由你定义</h3>
          <p>插件按声明使用笔记、命令和面板能力。安装后，由你选择是否启用。</p>
        </div>
        <span>
          <ShieldCheck size={14} />
          按权限运行
        </span>
      </div>
      <div className="plugin-list-toolbar">
        <div className="management-tabs">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            已安装 <span>{plugins.length}</span>
          </button>
          <button
            className={filter === "enabled" ? "active" : ""}
            onClick={() => setFilter("enabled")}
          >
            已启用{" "}
            <span>
              {enabled.filter((id) => plugins.some((p) => p.id === id)).length}
            </span>
          </button>
        </div>
        <label className="management-search">
          <Search size={14} />
          <input
            aria-label="搜索已安装插件"
            placeholder="搜索插件…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="plugin-rows">
        {list.map((plugin) => (
          <article className="plugin-row" key={plugin.id}>
            <span className="plugin-icon">
              <Puzzle size={21} />
            </span>
            <div className="plugin-description">
              <h3>
                {plugin.name}
                <small>v{plugin.version}</small>
              </h3>
              <p>{plugin.id}</p>
              <div className="plugin-permissions">
                {plugin.permissions.map((permission) => (
                  <span key={permission}>{names[permission]}</span>
                ))}
              </div>
              {details === plugin.id && (
                <div className="plugin-detail">
                  <strong>声明的权限</strong>
                  <p>
                    {plugin.permissions.map((p) => names[p]).join("、") ||
                      "未声明额外权限"}
                  </p>
                  {!!plugin.networkHosts?.length && (
                    <p>允许访问：{plugin.networkHosts.join("、")}</p>
                  )}
                  <p>
                    运行平台：{plugin.platforms.join(" / ")} · SDK{" "}
                    {plugin.apiVersion}
                  </p>
                </div>
              )}
            </div>
            <div className="plugin-row-actions">
              <button
                className="icon-button"
                aria-label={`查看 ${plugin.name} 权限`}
                onClick={() =>
                  setDetails(details === plugin.id ? null : plugin.id)
                }
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={`卸载 ${plugin.name}`}
                disabled={!native}
                onClick={() => {
                  if (
                    window.confirm(
                      `卸载插件“${plugin.name}”？笔记内容不会被删除。`,
                    )
                  )
                    void bridge
                      .call("plugins.remove", { id: plugin.id })
                      .then(async () => {
                        const values = enabled.filter((id) => id !== plugin.id);
                        await bridge.call("settings.set", {
                          key: "plugins.enabled",
                          value: values,
                        });
                        await load();
                        changed();
                      })
                      .catch((error) => setError(safeMessage(error)));
                }}
              >
                <Trash2 size={15} />
              </button>
              <button
                role="switch"
                aria-checked={enabled.includes(plugin.id)}
                aria-label={`启用 ${plugin.name}`}
                className="toggle-switch"
                onClick={() => {
                  const values = enabled.includes(plugin.id)
                    ? enabled.filter((id) => id !== plugin.id)
                    : [...enabled, plugin.id];
                  void bridge
                    .call("settings.set", {
                      key: "plugins.enabled",
                      value: values,
                    })
                    .then(() => {
                      setEnabled(values);
                      changed();
                    })
                    .catch((error) => setError(safeMessage(error)));
                }}
              >
                <span />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!list.length && (
        <div className="plugin-empty">
          <span>
            <Puzzle size={32} />
          </span>
          <h2>
            {plugins.length ? "没有匹配的插件" : "让 Obryth 更贴合你的习惯"}
          </h2>
          <p>
            {plugins.length
              ? "尝试其他名称，或切换到全部已安装插件。"
              : "从一个本地插件开始，添加命令、知识检索或自定义面板。"}
          </p>
          {!plugins.length && (
            <button
              className="outline-button"
              disabled={!native}
              onClick={install}
            >
              <FolderOpen size={14} />
              选择插件文件夹
            </button>
          )}
          <small>
            {!native
              ? "安装插件需使用桌面客户端"
              : "插件目录中需包含 manifest.json 与 entry.js"}
          </small>
        </div>
      )}
      <div className="plugin-developer">
        <Code2 size={19} />
        <div>
          <strong>构建你自己的扩展</strong>
          <p>使用 Obryth SDK 注册命令、检索笔记和创建隔离面板。</p>
        </div>
        <code>examples/plugins/daily-review</code>
      </div>
      {error && <p className="inline-error">{error}</p>}
    </div>
  );
}
