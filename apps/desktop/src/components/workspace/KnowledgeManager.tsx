import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Database,
  FileText,
  Hash,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { KnowledgeScope, Note, ProviderProfile } from "@obryth/contracts";
import { bridge, native, safeMessage } from "../../lib/bridge";
import { useWorkbench } from "../../lib/workbench";
type Mount = { id: string; name: string; scope: KnowledgeScope };
const fresh = (): Mount => ({
  id: crypto.randomUUID(),
  name: "新的知识范围",
  scope: { includeTags: [], excludeTags: [] },
});
const all: Mount = {
  id: "all",
  name: "全部笔记",
  scope: { includeTags: [], excludeTags: [] },
};
export function KnowledgeManager({
  useScope,
  settings,
}: {
  useScope: (scope: KnowledgeScope) => void;
  settings: () => void;
}) {
  const w = useWorkbench();
  const [mounts, setMounts] = useState<Mount[]>([all]);
  const [selected, setSelected] = useState<Mount>(all);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [root, setRoot] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    void bridge
      .call<Mount[] | null>("settings.get", { key: "knowledge.mounts" })
      .then((value) => {
        if (value?.length) {
          setMounts(value);
          setSelected(value[0]);
        }
      })
      .catch((error) => w.notify(safeMessage(error)));
    void bridge
      .call<{ root: string }>("vault.info")
      .then((value) => setRoot(value.root));
    void bridge.call<ProviderProfile[]>("providers.list").then((value) => {
      const profiles = value.filter((p) => p.purpose === "embedding");
      setProviders(profiles);
      setProvider(profiles[0]?.id ?? "");
      setModel(profiles[0]?.models[0] ?? "");
    });
  }, []);
  const matches = (note: Note) =>
    !selected.scope.excludeTags.some((tag) => note.tags.includes(tag)) &&
    (!selected.scope.includeTags.length ||
      selected.scope.includeTags.some((tag) => note.tags.includes(tag)));
  const notes = w.notes.filter(matches);
  const tags = Array.from(new Set(w.notes.flatMap((n) => n.tags))).sort();
  const persist = async (values: Mount[]) => {
    try {
      await bridge.call("settings.set", {
        key: "knowledge.mounts",
        value: values,
      });
      setMounts(values);
      w.notify("知识范围已保存");
    } catch (error) {
      w.notify(safeMessage(error));
    }
  };
  const toggle = (key: "includeTags" | "excludeTags", tag: string) =>
    setSelected({
      ...selected,
      scope: {
        ...selected.scope,
        [key]: selected.scope[key].includes(tag)
          ? selected.scope[key].filter((t) => t !== tag)
          : [...selected.scope[key], tag],
      },
    });
  const shell = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return (
    <div className="management-page knowledge-page">
      <header className="management-header">
        <div className="page-breadcrumb">
          工作空间 <ChevronRight size={12} />
          知识库
        </div>
        <div className="page-heading">
          <div>
            <h1>知识库管理</h1>
            <p>把笔记组织为清晰的上下文，交给你的 AI。</p>
          </div>
          <button
            className="primary-button"
            onClick={() => {
              const value = fresh();
              setSelected(value);
              setMounts([...mounts, value]);
            }}
          >
            <Plus size={15} />
            新建知识范围
          </button>
        </div>
      </header>
      <div className="knowledge-overview">
        <div>
          <Database size={18} />
          <strong>{w.notes.length}</strong>
          <span>当前加载的笔记</span>
        </div>
        <div>
          <Hash size={18} />
          <strong>{tags.length}</strong>
          <span>知识标签</span>
        </div>
        <div>
          <Layers3 size={18} />
          <strong>{mounts.length}</strong>
          <span>知识范围</span>
        </div>
        <div>
          <ShieldCheck size={18} />
          <strong>本地优先</strong>
          <span>全文检索无需模型</span>
        </div>
      </div>
      <div className="knowledge-layout">
        <aside className="mount-list">
          <div className="section-caption">
            知识范围 <span>{mounts.length}</span>
          </div>
          {mounts.map((mount) => (
            <button
              key={mount.id}
              className={mount.id === selected.id ? "active" : ""}
              onClick={() => setSelected(mount)}
            >
              <span className="mount-icon">
                <Layers3 size={16} />
              </span>
              <span>
                <strong>{mount.name}</strong>
                <small>
                  {mount.scope.includeTags.length
                    ? mount.scope.includeTags.map((t) => `#${t}`).join(" · ")
                    : "所有笔记"}
                </small>
              </span>
              <ChevronRight size={13} />
            </button>
          ))}
          <p className="scope-help">包含标签取并集。排除标签优先于包含标签。</p>
        </aside>
        <section className="scope-detail">
          <header>
            <div>
              <span className="section-caption">范围设置</span>
              <input
                aria-label="知识范围名称"
                value={selected.name}
                onChange={(event) =>
                  setSelected({ ...selected, name: event.target.value })
                }
              />
            </div>
            <button
              className="icon-button"
              aria-label="删除知识范围"
              disabled={mounts.length === 1}
              onClick={() => {
                const values = mounts.filter((m) => m.id !== selected.id);
                void persist(values);
                setSelected(values[0]);
              }}
            >
              <Trash2 size={15} />
            </button>
            <button
              className="outline-button"
              onClick={() =>
                void persist(
                  mounts.map((m) => (m.id === selected.id ? selected : m)),
                )
              }
            >
              <Check size={14} />
              保存
            </button>
          </header>
          <div className="scope-fields">
            {(["includeTags", "excludeTags"] as const).map((key) => (
              <div key={key}>
                <label>
                  {key === "includeTags" ? "包含标签" : "排除标签"}
                  <small>
                    {key === "includeTags"
                      ? "未选择时包含全部笔记"
                      : "始终从检索结果中移除"}
                  </small>
                </label>
                <div className="scope-tags">
                  {tags.length ? (
                    tags.map((tag) => (
                      <button
                        key={tag}
                        className={
                          selected.scope[key].includes(tag) ? "selected" : ""
                        }
                        onClick={() => toggle(key, tag)}
                      >
                        <Hash size={12} />
                        {tag}
                        {selected.scope[key].includes(tag) && (
                          <Check size={12} />
                        )}
                      </button>
                    ))
                  ) : (
                    <span className="subtle">
                      为笔记添加标签后，即可在这里配置范围。
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="scope-actions">
            <button
              className="primary-button"
              onClick={() => useScope(selected.scope)}
            >
              <Sparkles size={14} />
              在知识助手中使用
            </button>
            <button
              className="outline-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(
                    `obryth --vault ${shell(root)} mcp${selected.scope.includeTags.map((t) => ` --tag ${shell(t)}`).join("")}${selected.scope.excludeTags.map((t) => ` --exclude-tag ${shell(t)}`).join("")}`,
                  )
                  .then(() => w.notify("MCP 命令已复制"))
                  .catch((error) => w.notify(safeMessage(error)));
              }}
            >
              <Copy size={14} />
              复制 MCP 配置命令
            </button>
          </div>
          <div className="scope-preview">
            <header>
              <h3>
                范围内的笔记 <span>{notes.length}</span>
              </h3>
              <label>
                <Search size={13} />
                <input
                  aria-label="搜索范围内笔记"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="筛选笔记"
                />
              </label>
            </header>
            {notes
              .filter((note) =>
                `${note.title} ${note.body}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .slice(0, 30)
              .map((note) => (
                <button
                  key={note.id}
                  className="scope-note"
                  onClick={() => w.open("document", note.id, note.title)}
                >
                  <FileText size={14} />
                  <span>{note.title}</span>
                  <small>{note.tags.map((t) => `#${t}`).join(" ")}</small>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            {!notes.length && (
              <div className="scope-empty">
                <Database size={24} />
                <p>当前范围内没有笔记</p>
                <small>更改标签筛选，或先创建一篇笔记。</small>
              </div>
            )}
          </div>
          <section className="semantic-settings">
            <div>
              <Sparkles size={16} />
              <h3>语义检索</h3>
              <span>可选 · 使用你的 API</span>
            </div>
            <p>
              本地全文检索始终可用。配置 Embedding API
              后，可为当前范围增量建立语义索引。
            </p>
            {providers.length ? (
              <div className="semantic-form">
                <select
                  aria-label="Embedding 服务"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setModel(
                      providers.find((p) => p.id === e.target.value)
                        ?.models[0] ?? "",
                    );
                  }}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Embedding 模型"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="模型名称"
                />
                <button
                  className="outline-button"
                  disabled={busy || !native || !model}
                  onClick={() => {
                    setBusy(true);
                    void bridge
                      .call<{ indexed: number }>("knowledge.index", {
                        profileId: provider,
                        model,
                        scope: selected.scope,
                      })
                      .then((value) =>
                        w.notify(`语义索引已更新：${value.indexed} 篇笔记`),
                      )
                      .catch((error) => w.notify(safeMessage(error)))
                      .finally(() => setBusy(false));
                  }}
                >
                  <RefreshCw size={13} className={busy ? "spin" : ""} />
                  {busy ? "正在建立索引" : "更新索引"}
                </button>
              </div>
            ) : (
              <button className="text-link" onClick={settings}>
                配置 Embedding API <ArrowUpRight size={13} />
              </button>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}
