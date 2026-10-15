import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Alert,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView } from "react-native-webview";
import * as WebBrowser from "expo-web-browser";
import type {
  Note,
  ProviderProfile,
  SearchHit,
  SyncReport,
} from "@obryth/contracts";
import { mobileBridge as core } from "./src/core";
import { RemotePane } from "./src/RemotePane";
type Draft = { title: string; body: string; tags: string; revision: string };
export default function App() {
  return (
    <SafeAreaProvider>
      <Workspace />
    </SafeAreaProvider>
  );
}
function Workspace() {
  const { width } = useWindowDimensions();
  const dark = useColorScheme() === "dark";
  const tablet = width >= 800;
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("source");
  const [status, setStatus] = useState("本地知识库");
  const [settings, setSettings] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState<ProviderProfile>({
    id: "mobile-api",
    name: "我的 API",
    protocol: "openai-compatible",
    endpoint: "https://api.openai.com/v1",
    models: [],
    secretRef: "obryth.provider.mobile",
    purpose: "chat",
  });
  const [secret, setSecret] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState("notes");
  const [browserUrl, setBrowserUrl] = useState("https://en.wikipedia.org");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const saving = useRef(false);
  const pendingDraft = useRef(Promise.resolve());
  const input = useRef<TextInput>(null);
  const selection = useRef({ start: 0, end: 0 });
  const fail = (error: unknown) => {
    setStatus(String(error));
    Alert.alert("Obryth", String(error));
  };
  const refresh = async () => {
    const hits = await core.call<SearchHit[]>("notes.list", {
      text: query,
      limit: 200,
    });
    setNotes(hits.map((hit) => hit.note));
  };
  const save = async () => {
    if (saving.current || !selectedRef.current || !draftRef.current) return;
    const note = selectedRef.current;
    const value = { ...draftRef.current };
    if (
      note.title === value.title &&
      note.body === value.body &&
      note.tags.join(",") === value.tags
    )
      return;
    saving.current = true;
    setStatus("保存中…");
    try {
      const updated = await core.call<Note>("notes.save", {
        id: note.id,
        title: value.title,
        body: value.body,
        tags: value.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        kind: note.kind,
        pinned: note.pinned,
        source: note.source,
        baseRevision: value.revision,
      });
      if (selectedRef.current?.id === updated.id) {
        setSelected(updated);
        if (
          draftRef.current?.body === value.body &&
          draftRef.current?.title === value.title
        )
          setDraft({ ...value, revision: updated.revision });
        else if (draftRef.current)
          setDraft({ ...draftRef.current, revision: updated.revision });
      }
      pendingDraft.current = pendingDraft.current.then(() =>
        AsyncStorage.setItem(
          `draft.${note.id}`,
          JSON.stringify({ ...draftRef.current, revision: updated.revision }),
        ),
      );
      await pendingDraft.current;
      setStatus("已保存到本机");
      await refresh();
    } catch (error) {
      setStatus(`草稿已保留：${String(error)}`);
    } finally {
      saving.current = false;
    }
  };
  useEffect(() => {
    void refresh().catch(fail);
    void core
      .call<{ endpoint: string; username: string } | null>("settings.get", {
        key: "sync.webdav",
      })
      .then((v) => {
        if (v) {
          setEndpoint(v.endpoint);
          setUsername(v.username);
        }
      })
      .catch(() => {});
    void core
      .call<ProviderProfile[]>("providers.list")
      .then((list) => {
        if (list[0]) setProvider(list[0]);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => void refresh().catch((error) => setStatus(String(error))),
      250,
    );
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!selected || !draft) return;
    pendingDraft.current = pendingDraft.current
      .then(() =>
        AsyncStorage.setItem(`draft.${selected.id}`, JSON.stringify(draft)),
      )
      .catch((error) => setStatus(`草稿保存失败：${String(error)}`));
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") void save();
    });
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectedRef.current && !tablet) {
        void save();
        setSelected(null);
        setDraft(null);
        return true;
      }
      return false;
    });
    return () => {
      listener.remove();
      back.remove();
    };
  }, [tablet]);
  const open = async (note: Note) => {
    await save();
    const cached = await AsyncStorage.getItem(`draft.${note.id}`);
    setSelected(note);
    const local = cached ? (JSON.parse(cached) as Draft) : null;
    setDraft(
      local ?? {
        title: note.title,
        body: note.body,
        tags: note.tags.join(","),
        revision: note.revision,
      },
    );
    setStatus(
      local && local.revision !== note.revision
        ? "检测到其他版本：草稿已保留，请复制并合并"
        : "本地知识库",
    );
  };
  const create = async () => {
    try {
      const note = await core.call<Note>("notes.save", {
        title: "新的想法",
        body: "",
        tags: ["inbox"],
        kind: "memo",
      });
      await refresh();
      await open(note);
    } catch (error) {
      fail(error);
    }
  };
  const change = (patch: Partial<Draft>) =>
    setDraft((value) => (value ? { ...value, ...patch } : value));
  const insert = (text: string) => {
    if (!draft) return;
    const { start, end } = selection.current;
    change({ body: draft.body.slice(0, start) + text + draft.body.slice(end) });
  };
  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await save();
      await core.call("sync.configure", {
        endpoint,
        username,
        password: password || undefined,
      });
      setPassword("");
      const report = await core.call<SyncReport>("sync.run", {
        endpoint,
        username,
        secretRef: "obryth.sync.webdav",
      });
      setStatus(
        `同步完成 · ↑${report.uploaded} ↓${report.downloaded} · ${report.conflicts.length} 个冲突`,
      );
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const list = (
    <View style={[s.list, tablet && s.tabletList]}>
      <View style={s.listHeading}>
        <Text style={s.heading}>你的笔记</Text>
        <Pressable accessibilityLabel="新建笔记" onPress={() => void create()}>
          <Text style={s.plus}>＋</Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="搜索笔记"
        placeholder="搜索笔记与想法…"
        placeholderTextColor="#9ba697"
        value={query}
        onChangeText={setQuery}
        style={s.search}
      />
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 30 }}
        ListEmptyComponent={
          <Text style={s.empty}>捕捉一个新的想法，开始你的知识库。</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void open(item)}
            style={[s.noteCard, selected?.id === item.id && s.selectedCard]}
          >
            <Text style={s.cardTitle}>{item.title}</Text>
            <Text numberOfLines={2} style={s.excerpt}>
              {item.body.replace(/[#*`>]/g, "").slice(0, 100) ||
                "等待新的想法…"}
            </Text>
            <Text style={s.tags}>
              {item.tags.map((tag) => `#${tag}`).join("  ")}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
  const editor =
    draft && selected ? (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.editor}
      >
        <View style={s.editorToolbar}>
          {!tablet && (
            <Pressable
              onPress={() => {
                void save();
                setSelected(null);
                setDraft(null);
              }}
            >
              <Text style={s.link}>‹ 笔记</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setMode(mode === "source" ? "preview" : "source")}
          >
            <Text style={s.link}>
              {mode === "source" ? "预览" : "Markdown"}
            </Text>
          </Pressable>
          <Pressable onPress={() => void save()}>
            <Text style={s.link}>保存</Text>
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="笔记标题"
          style={s.title}
          value={draft.title}
          onChangeText={(title) => change({ title })}
          allowFontScaling
        />
        <TextInput
          accessibilityLabel="笔记标签"
          style={s.tagsInput}
          value={draft.tags}
          onChangeText={(tags) => change({ tags })}
          placeholder="标签，以英文逗号分隔"
        />
        {mode === "source" ? (
          <TextInput
            ref={input}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Markdown 正文"
            value={draft.body}
            onChangeText={(body) => change({ body })}
            onSelectionChange={(event) => {
              selection.current = event.nativeEvent.selection;
            }}
            style={s.source}
            autoCorrect={false}
            autoCapitalize="none"
            scrollEnabled
          />
        ) : (
          <WebView
            source={{ html: markdownPreview(draft.body) }}
            originWhitelist={["about:blank"]}
            onShouldStartLoadWithRequest={(request) =>
              request.url === "about:blank"
            }
            style={s.preview}
          />
        )}
        <View style={s.keyboardBar}>
          {["# ", "**", "`", "- ", "[]()", "\n```\n\n```\n"].map((text) => (
            <Pressable key={text} onPress={() => insert(text)} style={s.key}>
              <Text style={s.keyText}>{text.trim().slice(0, 5) || "↵"}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => input.current?.blur()}>
            <Text style={s.keyText}>⌄</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    ) : (
      <View style={s.editor}>
        <Text style={s.empty}>选择一条笔记，继续你的思考。</Text>
      </View>
    );
  return (
    <SafeAreaView style={[s.safe, dark && { backgroundColor: "#eef2ed" }]}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View style={s.brand}>
          <Text style={s.mark}>o</Text>
          <Text style={s.brandName}>obryth</Text>
        </View>
        <Pressable
          accessibilityLabel="同步"
          onPress={() => void sync()}
          disabled={busy}
        >
          <Text style={s.headerButton}>{busy ? "同步中" : "↻ 同步"}</Text>
        </Pressable>
        <Pressable accessibilityLabel="设置" onPress={() => setSettings(true)}>
          <Text style={s.headerButton}>⚙</Text>
        </Pressable>
      </View>
      <View style={s.body}>
        {page === "notes" ? (
          <>
            {(tablet || !selected) && list}
            {(tablet || selected) && editor}
          </>
        ) : page === "remote" ? (
          <RemotePane note={selected} />
        ) : page === "assistant" ? (
          <ScrollView style={s.assistant} keyboardShouldPersistTaps="handled">
            <Text style={s.heading}>知识助手</Text>
            <Text style={s.description}>
              使用你的 API 服务，按标签检索本机笔记。
            </Text>
            <TextInput
              value={tags}
              onChangeText={setTags}
              style={s.search}
              placeholder="包含标签，留空为全部"
            />
            <TextInput
              multiline
              value={question}
              onChangeText={setQuestion}
              style={[s.formInput, { height: 100 }]}
              placeholder="询问你的知识库…"
            />
            <Pressable
              style={s.primary}
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void core
                  .call<{ answer: string }>("knowledge.ask", {
                    profileId: provider.id,
                    model: provider.models[0],
                    question,
                    scope: {
                      includeTags: tags.split(",").filter(Boolean),
                      excludeTags: [],
                    },
                  })
                  .then((result) => setAnswer(result.answer))
                  .catch(fail)
                  .finally(() => setBusy(false));
              }}
            >
              <Text style={s.primaryText}>{busy ? "思考中…" : "发送"}</Text>
            </Pressable>
            <Text selectable style={s.answer}>
              {answer}
            </Text>
          </ScrollView>
        ) : (
          <View style={s.editor}>
            <View style={s.browserBar}>
              <TextInput
                value={browserUrl}
                onChangeText={setBrowserUrl}
                style={s.browserInput}
                autoCapitalize="none"
              />
              <Pressable
                onPress={() =>
                  void WebBrowser.openBrowserAsync(browserUrl).catch(fail)
                }
              >
                <Text style={s.link}>打开</Text>
              </Pressable>
            </View>
            <Text style={s.description}>
              浏览器使用系统登录态与阅读体验。剪藏内容可先通过分享菜单复制，再保存到笔记。
            </Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={s.status}>
        {status}
      </Text>
      <View style={s.bottomNav}>
        {[
          { id: "notes", label: "▤ 笔记" },
          { id: "assistant", label: "✧ 知识助手" },
          { id: "remote", label: "⌘ Agent" },
          { id: "browser", label: "◎ 浏览器" },
        ].map((item) => (
          <Pressable
            key={item.id}
            onPress={() => {
              void save();
              setPage(item.id);
            }}
          >
            <Text style={[s.navText, page === item.id && s.activeNav]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={settings}
        animationType="slide"
        onRequestClose={() => setSettings(false)}
      >
        <SafeAreaView style={s.safe}>
          <View style={s.header}>
            <Text style={s.heading}>设置与连接</Text>
            <Pressable onPress={() => setSettings(false)}>
              <Text style={s.link}>完成</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={s.settingsContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.heading}>WebDAV 同步</Text>
            <TextInput
              style={s.formInput}
              value={endpoint}
              onChangeText={setEndpoint}
              autoCapitalize="none"
              placeholder="https://dav.example.com/"
            />
            <TextInput
              style={s.formInput}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              placeholder="用户名"
            />
            <TextInput
              style={s.formInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="密码（留空保留）"
            />
            <Pressable style={s.primary} onPress={() => void sync()}>
              <Text style={s.primaryText}>保存并同步</Text>
            </Pressable>
            <Text style={[s.heading, { marginTop: 35 }]}>API 服务</Text>
            <TextInput
              style={s.formInput}
              value={provider.endpoint}
              onChangeText={(endpoint) =>
                setProvider({ ...provider, endpoint })
              }
              autoCapitalize="none"
              placeholder="API endpoint"
            />
            <TextInput
              style={s.formInput}
              value={provider.models.join(",")}
              onChangeText={(text) =>
                setProvider({
                  ...provider,
                  models: text.split(",").map((s) => s.trim()),
                })
              }
              autoCapitalize="none"
              placeholder="模型名称"
            />
            <TextInput
              style={s.formInput}
              value={secret}
              onChangeText={setSecret}
              secureTextEntry
              placeholder="API Key（系统安全存储）"
            />
            <Pressable
              style={s.primary}
              onPress={() =>
                void core
                  .call("providers.save", {
                    profile: provider,
                    secret: secret || undefined,
                  })
                  .then(() => {
                    setSecret("");
                    Alert.alert("Obryth", "服务已保存");
                  })
                  .catch(fail)
              }
            >
              <Text style={s.primaryText}>保存服务</Text>
            </Pressable>
            <Text style={s.description}>
              移动端使用与桌面相同的 Rust 知识核心。原生模块需要 development
              build。
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
function markdownPreview(value: string) {
  const safe = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><style>body{font-family:-apple-system,system-ui;font-size:17px;line-height:1.85;color:#364338;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:26px}h2{font-size:22px}code{font-family:monospace;background:#f1f4ee;padding:3px}blockquote{border-left:2px solid #9ead92;padding-left:14px}</style></head><body>${safe
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</body></html>`;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fafbf9" },
  header: {
    height: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderColor: "#e7ece3",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  mark: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 33,
    backgroundColor: "#dce9d9",
    color: "#476446",
    width: 34,
    height: 34,
    textAlign: "center",
    lineHeight: 33,
    borderRadius: 10,
  },
  brandName: {
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -1,
    color: "#354335",
  },
  headerButton: { fontSize: 14, color: "#7b9172", paddingLeft: 20 },
  body: { flex: 1, flexDirection: "row" },
  list: { flex: 1, paddingHorizontal: 18, paddingTop: 24 },
  tabletList: { maxWidth: 300, borderRightWidth: 1, borderColor: "#e7ece3" },
  listHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heading: {
    fontSize: 21,
    fontWeight: "600",
    color: "#354335",
    marginBottom: 14,
  },
  plus: { fontSize: 27, color: "#78936a", padding: 6 },
  search: {
    backgroundColor: "#f0f3ed",
    borderRadius: 10,
    padding: 13,
    color: "#384536",
    marginBottom: 20,
    fontSize: 14,
  },
  noteCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e9eee6",
    borderRadius: 12,
    padding: 18,
    marginBottom: 11,
  },
  selectedCard: { borderColor: "#9fb494" },
  cardTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#394637",
    marginBottom: 8,
  },
  excerpt: { fontSize: 13, color: "#9aa492", lineHeight: 21, marginBottom: 12 },
  tags: { fontSize: 11, color: "#93a581" },
  empty: {
    color: "#a2ad99",
    padding: 35,
    lineHeight: 26,
    fontSize: 14,
    textAlign: "center",
  },
  editor: { flex: 1, minWidth: 0 },
  editorToolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderColor: "#edf0e9",
  },
  link: { color: "#6c8e5c", fontSize: 14, padding: 4 },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#354335",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 14,
  },
  tagsInput: {
    fontSize: 12,
    color: "#93a581",
    paddingHorizontal: 24,
    paddingBottom: 14,
  },
  source: {
    flex: 1,
    fontSize: 16,
    lineHeight: 26,
    paddingHorizontal: 24,
    paddingTop: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#465140",
  },
  preview: { flex: 1, backgroundColor: "#fafbf9" },
  keyboardBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    backgroundColor: "#f0f3ed",
    borderTopWidth: 1,
    borderColor: "#e3e9dd",
    height: 43,
  },
  key: { padding: 8 },
  keyText: {
    fontSize: 15,
    color: "#7b916f",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  status: {
    fontSize: 10,
    color: "#93a088",
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  bottomNav: {
    height: 52,
    borderTopWidth: 1,
    borderColor: "#e7ece3",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  navText: { fontSize: 13, color: "#a4ad9e", padding: 10 },
  activeNav: { color: "#608051", fontWeight: "600" },
  assistant: { flex: 1, padding: 24 },
  description: {
    fontSize: 13,
    lineHeight: 23,
    color: "#97a08e",
    marginVertical: 18,
    marginHorizontal: 12,
  },
  formInput: {
    borderWidth: 1,
    borderColor: "#e1e7da",
    padding: 14,
    borderRadius: 8,
    fontSize: 14,
    color: "#465140",
    marginBottom: 12,
  },
  primary: {
    backgroundColor: "#769b65",
    borderRadius: 9,
    padding: 14,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "500" },
  answer: { fontSize: 16, lineHeight: 28, color: "#465140", marginTop: 30 },
  settingsContent: { padding: 25, paddingBottom: 70 },
  browserBar: {
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  browserInput: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f0f3ed",
    fontSize: 13,
  },
});
