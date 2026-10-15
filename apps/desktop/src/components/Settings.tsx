import { useEffect, useState } from "react";
import {
  X,
  Plus,
  Server,
  KeyRound,
  RefreshCw,
  FolderSync,
  Download,
  Upload,
  ShieldCheck,
  Palette,
  TerminalSquare,
} from "lucide-react";
import type { ProviderProfile, SyncReport } from "@obryth/contracts";
import { bridge, native, safeMessage } from "../lib/bridge";
import { useWorkbench } from "../lib/workbench";
import { PluginSettings } from "./PluginSettings";
import { ProposalReview } from "./ProposalReview";
import { AppearanceSettings } from "./AppearanceSettings";
import { TerminalSettings } from "./TerminalSettings";
import type { AppearancePreferences } from "../lib/appearance";
const fresh = (): ProviderProfile => {
  const id = crypto.randomUUID();
  return {
    id,
    name: "",
    protocol: "openai-compatible",
    endpoint: "https://api.openai.com/v1",
    models: [],
    secretRef: `obryth.provider.${id}`,
    purpose: "chat",
  };
};
export function Settings({
  close,
  initialTab = "providers",
  appearance,
  changeAppearance,
  reducedTransparency,
}: {
  close: () => void;
  initialTab?: string;
  appearance: AppearancePreferences;
  changeAppearance: (preferences: AppearancePreferences) => void;
  reducedTransparency: boolean;
}) {
  const workbench = useWorkbench();
  const [tab, setTab] = useState(initialTab);
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [profile, setProfile] = useState(fresh);
  const [secret, setSecret] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [pairing, setPairing] = useState("");
  const [conflicts, setConflicts] = useState<
    {
      id: string;
      local: {
        id: string;
        body: string;
        title: string;
        revision: string;
        tags: string[];
        kind: string;
        pinned: boolean;
      } | null;
      remote: {
        note: {
          id: string;
          body: string;
          title: string;
          tags: string[];
          kind: string;
          pinned: boolean;
        } | null;
        noteId: string;
      };
    }[]
  >([]);
  const load = () =>
    bridge.call<ProviderProfile[]>("providers.list").then(setProfiles);
  useEffect(() => {
    void load();
    void bridge
      .call<{ endpoint: string; username: string } | null>("settings.get", {
        key: "sync.webdav",
      })
      .then((value) => {
        if (value) {
          setEndpoint(value.endpoint);
          setUsername(value.username);
        }
      });
    void bridge.call<typeof conflicts>("conflicts.list").then(setConflicts);
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setStatus("");
    try {
      await action();
    } catch (error) {
      setStatus(safeMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const download = (name: string, value: unknown) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header>
          <div>
            <h2>设置</h2>
            <p>你的数据，你的工具。</p>
          </div>
          <button className="icon-button" aria-label="关闭设置" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <nav className="settings-tabs">
          <button
            className={tab === "terminal" ? "active" : ""}
            onClick={() => setTab("terminal")}
          >
            <TerminalSquare size={15} />
            终端
          </button>
          <button
            className={tab === "appearance" ? "active" : ""}
            onClick={() => setTab("appearance")}
          >
            <Palette size={15} />
            外观
          </button>
          <button
            className={tab === "plugins" ? "active" : ""}
            onClick={() => setTab("plugins")}
          >
            插件
          </button>
          <button
            className={tab === "review" ? "active" : ""}
            onClick={() => setTab("review")}
          >
            AI 变更
          </button>
          <button
            className={tab === "providers" ? "active" : ""}
            onClick={() => setTab("providers")}
          >
            <Server size={15} />
            API 服务
          </button>
          <button
            className={tab === "sync" ? "active" : ""}
            onClick={() => setTab("sync")}
          >
            <FolderSync size={15} />
            同步与冲突
          </button>
          <button
            className={tab === "about" ? "active" : ""}
            onClick={() => setTab("about")}
          >
            <ShieldCheck size={15} />
            工作空间
          </button>
        </nav>
        <div className="settings-body">
          {tab === "terminal" && <TerminalSettings />}
          {tab === "appearance" && (
            <AppearanceSettings
              preferences={appearance}
              change={changeAppearance}
              reducedTransparency={reducedTransparency}
            />
          )}
          {tab === "plugins" && <PluginSettings />}
          {tab === "review" && <ProposalReview />}
          {tab === "providers" && (
            <>
              <div className="provider-list">
                {profiles.map((item) => (
                  <button
                    key={item.id}
                    className={profile.id === item.id ? "selected" : ""}
                    onClick={() => {
                      setProfile(item);
                      setSecret("");
                    }}
                  >
                    <Server size={15} />
                    {item.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setProfile(fresh());
                    setSecret("");
                  }}
                >
                  <Plus size={14} />
                  新增服务
                </button>
              </div>
              <div className="form-grid">
                <label>
                  服务名称
                  <input
                    value={profile.name}
                    onChange={(event) =>
                      setProfile({ ...profile, name: event.target.value })
                    }
                    placeholder="例如：我的模型服务"
                  />
                </label>
                <label>
                  协议
                  <select
                    value={profile.protocol}
                    onChange={(event) =>
                      setProfile({ ...profile, protocol: event.target.value })
                    }
                  >
                    <option value="openai-compatible">OpenAI compatible</option>
                    <option value="responses">OpenAI Responses</option>
                    <option value="anthropic">Anthropic Messages</option>
                  </select>
                </label>
                <label className="full">
                  API 端点
                  <input
                    value={profile.endpoint}
                    onChange={(event) =>
                      setProfile({ ...profile, endpoint: event.target.value })
                    }
                  />
                </label>
                <label className="full">
                  API Key
                  <input
                    type="password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="保存在系统凭据存储 · 留空则保留原密钥"
                    autoComplete="off"
                  />
                </label>
                <label>
                  用途
                  <select
                    value={profile.purpose}
                    onChange={(event) =>
                      setProfile({ ...profile, purpose: event.target.value })
                    }
                  >
                    <option value="chat">聊天</option>
                    <option value="embedding">Embedding</option>
                  </select>
                </label>
                <label>
                  模型（英文逗号分隔）
                  <input
                    value={profile.models.join(",")}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        models: event.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </div>
              <div className="settings-actions">
                <button
                  disabled={busy || !native}
                  onClick={() =>
                    void run(async () => {
                      const models = await bridge.call<string[]>(
                        "providers.models",
                        { profile, secret: secret || undefined },
                      );
                      setProfile({ ...profile, models });
                      setStatus(`发现 ${models.length} 个模型`);
                    })
                  }
                >
                  <RefreshCw size={14} />
                  查询模型
                </button>
                <button
                  className="primary-button"
                  disabled={busy || !profile.name}
                  onClick={() =>
                    void run(async () => {
                      await bridge.call("providers.save", {
                        profile,
                        secret: secret || undefined,
                      });
                      setSecret("");
                      await load();
                      setStatus("服务已保存");
                    })
                  }
                >
                  <KeyRound size={14} />
                  保存服务
                </button>
              </div>
              <div className="settings-actions">
                <button
                  onClick={() => download("obryth-providers.json", profiles)}
                >
                  <Download size={14} />
                  导出配置
                </button>
                <label className="button">
                  <Upload size={14} />
                  导入配置
                  <input
                    type="file"
                    accept="application/json"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void run(async () => {
                          const list = JSON.parse(
                            await file.text(),
                          ) as ProviderProfile[];
                          if (!Array.isArray(list))
                            throw new Error("配置应为数组");
                          for (const profile of list)
                            await bridge.call("providers.save", { profile });
                          await load();
                          setStatus("配置已导入，密钥需在本机填写");
                        });
                    }}
                  />
                </label>
              </div>
              <p className="subtle">
                配置导出只包含密钥引用。你已有的 localhost 服务可作为 API
                端点接入。
              </p>
            </>
          )}
          {tab === "sync" && (
            <>
              <h3>端到端加密 WebDAV</h3>
              <label className="form-label">
                服务器地址
                <input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://dav.example.com/notes/"
                />
              </label>
              <div className="form-grid">
                <label>
                  用户名
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </label>
                <label>
                  密码
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="留空使用已保存的凭据"
                  />
                </label>
              </div>
              <button
                className="primary-button"
                disabled={busy || !native || !endpoint}
                onClick={() =>
                  void run(async () => {
                    await bridge.call("sync.configure", {
                      endpoint,
                      username,
                      password: password || undefined,
                    });
                    setPassword("");
                    const report = await bridge.call<SyncReport>("sync.run", {
                      endpoint,
                      username,
                      secretRef: "obryth.sync.webdav",
                    });
                    setStatus(
                      `已上传 ${report.uploaded}，下载 ${report.downloaded}，冲突 ${report.conflicts.length}`,
                    );
                    await workbench.refresh();
                    setConflicts(await bridge.call("conflicts.list"));
                  })
                }
              >
                <RefreshCw size={14} />
                保存并同步
              </button>
              <div className="sync-pairing">
                <h3>配对与恢复密钥</h3>
                <p>
                  在新设备导入配对文件即可连接同一知识库。请妥善保存，文件包含解密密钥。
                </p>
                <button
                  disabled={!native}
                  onClick={() =>
                    void run(async () => {
                      const value = await bridge.call("sync.pairing");
                      setPairing(JSON.stringify(value, null, 2));
                    })
                  }
                >
                  显示恢复信息
                </button>
                {pairing && (
                  <>
                    <pre>{pairing}</pre>
                    <button
                      onClick={() =>
                        download("obryth-recovery.json", JSON.parse(pairing))
                      }
                    >
                      下载恢复文件
                    </button>
                    <button onClick={() => setPairing("")}>隐藏</button>
                  </>
                )}
              </div>
              <h3>待处理冲突 · {conflicts.length}</h3>
              {conflicts.map((conflict) => (
                <article className="sync-conflict" key={conflict.id}>
                  <strong>
                    {conflict.local?.title ??
                      conflict.remote.note?.title ??
                      "删除冲突"}
                  </strong>
                  <div className="conflict-versions">
                    <pre>{conflict.local?.body ?? "本地已删除"}</pre>
                    <pre>{conflict.remote.note?.body ?? "远端已删除"}</pre>
                  </div>
                  {conflict.local && conflict.remote.note && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          const local = conflict.local!;
                          const remote = conflict.remote.note!;
                          await bridge.call("conflicts.resolve", {
                            id: conflict.id,
                            draft: { ...remote, baseRevision: local.revision },
                          });
                          setConflicts(await bridge.call("conflicts.list"));
                          await workbench.refresh();
                        })
                      }
                    >
                      采用远端内容
                    </button>
                  )}
                  <p className="subtle">
                    需要合并时，先在笔记中整理两份内容，再通过 CLI 确认解决。
                  </p>
                </article>
              ))}
            </>
          )}
          {tab === "about" && (
            <>
              <h3>Obryth · 0.1.0</h3>
              <p>笔记、终端与 AI 工作空间。</p>
              <p>
                Markdown 文件保存正文，Rust 服务统一处理版本与搜索，GUI 和独立
                TUI 使用同一个知识核心。
              </p>
              <p className="subtle">
                {native
                  ? "当前运行于原生桌面客户端。"
                  : "当前为浏览器预览：笔记保存在浏览器本地；系统终端、API 密钥与 WebDAV 需要原生客户端。"}
              </p>
              <button
                onClick={() =>
                  void bridge
                    .call<{ root: string }>("vault.info")
                    .then((info) => setStatus(info.root))
                }
              >
                查看知识库位置
              </button>
            </>
          )}
          {status && (
            <p className="settings-status" role="status">
              {status}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
