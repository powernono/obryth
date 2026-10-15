import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FilePlus2,
  Pin,
  Search,
  Send,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import type { ActivityQuery, ActivitySummary, Note } from "@obryth/contracts";
import { bridge, safeMessage } from "../../lib/bridge";
import { useWorkbench } from "../../lib/workbench";
import {
  activityKinds,
  activityPeriods,
  activityRange,
  defaultActivityPeriod,
  dateKey,
  shiftDay,
} from "../../lib/activity";
import { useActivityClock } from "../../lib/use-activity-clock";
import { ActivityHeatmap } from "./home/ActivityHeatmap";
import { ActivityStream } from "./home/ActivityStream";

const draftKey = "obryth.home.memo-draft.v1";
const draftEvent = "obryth:home-draft";
let saving = false;
let volatileDraft: string | null = null;
function readDraft() {
  if (volatileDraft !== null) return volatileDraft;
  try {
    return localStorage.getItem(draftKey) ?? "";
  } catch {
    return "";
  }
}
function subscribeDraft(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === draftKey || event.key === null) {
      volatileDraft = null;
      listener();
    }
  };
  window.addEventListener(draftEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(draftEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function HomePane() {
  const workbench = useWorkbench();
  const draft = useSyncExternalStore(subscribeDraft, readDraft);
  const busy = useSyncExternalStore(subscribeDraft, () => saving);
  const [period, setPeriod] = useState<string>(defaultActivityPeriod);
  const [kind, setKind] = useState("all");
  const [selection, setSelectedDay] = useState<string | null>(null);
  const clock = useActivityClock();
  const [summary, setSummary] = useState<{
    key: string;
    data: ActivitySummary;
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [captureError, setCaptureError] = useState("");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const capture = useRef<HTMLTextAreaElement>(null);
  const range = useMemo(
    () => activityRange(period, clock.today, kind, clock.zone),
    [period, clock, kind],
  );
  const rangeKey = JSON.stringify(range);
  const selectedDay =
    selection &&
    selection >= range.from &&
    selection < range.to &&
    selection <= clock.today
      ? selection
      : null;
  useEffect(() => {
    setSelectedDay((day) =>
      day && day >= range.from && day < range.to && day <= clock.today
        ? day
        : null,
    );
  }, [range.from, range.to, clock.today]);
  const data = summary?.key === rangeKey ? summary.data : null;
  useEffect(() => {
    let current = true;
    setError("");
    bridge
      .call<ActivitySummary>("notes.activity", range)
      .then((data) => {
        if (current) setSummary({ key: rangeKey, data });
      })
      .catch((e) => {
        if (current) setError(safeMessage(e));
      });
    return () => {
      current = false;
    };
  }, [rangeKey, workbench.notes, workbench.activePaneKind, retry]);
  const feedRange: ActivityQuery = selectedDay
    ? { ...range, from: selectedDay, to: shiftDay(selectedDay, 1) }
    : range;
  const recent = [...workbench.notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const pinned = workbench.notes.filter((note) => note.pinned).slice(0, 3);
  const modifier = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";
  const updateDraft = (value: string) => {
    volatileDraft = value;
    try {
      localStorage.setItem(draftKey, value);
      setCaptureError("");
    } catch (e) {
      setCaptureError(`草稿未能保留：${safeMessage(e)}`);
    } finally {
      window.dispatchEvent(new Event(draftEvent));
    }
  };
  const saveMemo = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    saving = true;
    setCaptureError("");
    window.dispatchEvent(new Event(draftEvent));
    try {
      await bridge.call<Note>("notes.save", {
        title:
          body
            .split("\n")[0]
            .replace(/^#+\s*/, "")
            .slice(0, 60) || "随手记",
        body,
        tags: Array.from(
          new Set(
            [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(
              (match) => match[1],
            ),
          ),
        ),
        kind: "memo",
      });
      updateDraft("");
      setPeriod(defaultActivityPeriod);
      setSelectedDay(null);
      setKind("all");
      setRetry((n) => n + 1);
      workbench.notify("已保存到随手记");
      await workbench.refresh().catch((e) => {
        setCaptureError(`笔记已保存，列表刷新失败：${safeMessage(e)}`);
      });
    } catch (e) {
      setCaptureError(`保存失败，草稿已保留：${safeMessage(e)}`);
    } finally {
      saving = false;
      window.dispatchEvent(new Event(draftEvent));
      capture.current?.focus();
    }
  };
  const createNote = async () => {
    try {
      const note = await bridge.call<Note>("notes.save", {
        title: "未命名笔记",
        body: "",
        tags: [],
        kind: "document",
      });
      workbench.open("document", note.id, note.title);
      await workbench.refresh();
    } catch (e) {
      workbench.notify(safeMessage(e));
    }
  };
  return (
    <div className="home-pane">
      <div className="home-content">
        <header className="home-heading">
          <div>
            <span className="home-eyebrow">YOUR EVERYDAY, COLLECTED</span>
            <h1>记录，让想法留下来。</h1>
          </div>
          <time dateTime={clock.today}>
            {new Intl.DateTimeFormat("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
              timeZone: "UTC",
            }).format(new Date(`${clock.today}T12:00:00Z`))}
          </time>
        </header>
        <section className="home-activity" aria-label="保存活动">
          <header className="activity-heading">
            <div>
              <h2>
                <CalendarDays size={15} />
                保存活动
              </h2>
              <span className="activity-totals" aria-live="polite">
                {data ? (
                  <>
                    <strong>{data.totalSaves.toLocaleString()}</strong> 次保存
                    <span className="activity-dot">·</span>
                    <strong>{data.activeDays}</strong> 个活跃日
                  </>
                ) : error ? (
                  "暂时无法读取"
                ) : (
                  "正在读取活动…"
                )}
              </span>
            </div>
            <select
              aria-label="活动时间范围"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setSelectedDay(null);
              }}
            >
              {activityPeriods.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
              {[
                ...new Set([
                  Number(clock.today.slice(0, 4)),
                  ...(summary?.data.years ?? []),
                  ...(/^\d{4}$/.test(period) ? [Number(period)] : []),
                ]),
              ]
                .sort((a, b) => b - a)
                .map((year) => (
                  <option key={year} value={year}>
                    {year} 年
                  </option>
                ))}
            </select>
          </header>
          {error && (
            <div className="home-error" role="alert">
              读取活动失败：{error}
              <button onClick={() => setRetry((n) => n + 1)}>重试</button>
            </div>
          )}
          <ActivityHeatmap
            range={range}
            days={data?.days ?? []}
            loaded={!!data}
            today={clock.today}
            selected={selectedDay}
            select={(day) =>
              setSelectedDay((old) => (old === day ? null : day))
            }
          />
          {data?.historyIncomplete && (
            <p className="home-history-notice">
              旧版浏览器预览仅保留了当前版本；更早的保存历史无法补全。
            </p>
          )}
        </section>
        <div className="home-columns">
          <main className="home-main">
            <section className="home-capture" aria-label="快速记录">
              <div className="home-section-label">
                <Sparkles size={14} />
                <span>此刻，想记点什么？</span>
                <span className="home-local">
                  <Check size={12} /> 本地保存
                </span>
              </div>
              <textarea
                ref={capture}
                aria-label="记录一个想法"
                placeholder="写下一个想法，或今天的小小进展…  #标签"
                value={draft}
                disabled={busy}
                onChange={(e) => updateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    (e.metaKey || e.ctrlKey) &&
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void saveMemo();
                  }
                }}
              />
              <footer>
                <span>
                  {draft ? "草稿已保留" : "支持 Markdown"}
                  <kbd>{modifier} ↵</kbd>
                </span>
                <button
                  className="primary-button"
                  disabled={!draft.trim() || busy}
                  onClick={() => void saveMemo()}
                >
                  <Send size={13} />
                  {busy ? "保存中…" : "保存想法"}
                </button>
              </footer>
              {captureError && (
                <p className="home-error" role="alert">
                  {captureError}
                </p>
              )}
            </section>
            <div className="home-feed-toolbar">
              <nav className="home-kind-filter" aria-label="记录类型">
                {activityKinds.map((item) => (
                  <button
                    key={item.value}
                    aria-pressed={kind === item.value}
                    onClick={() => setKind(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <div className="home-feed-scope">
                {selectedDay ? (
                  <button
                    className="home-date-filter"
                    onClick={() => setSelectedDay(null)}
                    aria-label="清除日期筛选"
                  >
                    {selectedDay}
                    <X size={12} />
                  </button>
                ) : (
                  <span className="home-feed-caption">按保存时间</span>
                )}
              </div>
            </div>
            <ActivityStream range={feedRange} refreshKey={retry} />
          </main>
          <aside className={`home-aside ${extrasOpen ? "is-expanded" : ""}`}>
            <button
              className="home-aside-toggle"
              aria-expanded={extrasOpen}
              onClick={() => setExtrasOpen((v) => !v)}
            >
              快捷入口与常用笔记
              <ChevronDown size={14} />
            </button>
            <div className="home-aside-content">
              <nav className="home-actions" aria-label="主页快捷入口">
                {[
                  {
                    label: "新建文档",
                    Icon: FilePlus2,
                    run: () => void createNote(),
                  },
                  {
                    label: "搜索笔记",
                    Icon: Search,
                    run: () => workbench.open("search"),
                  },
                  {
                    label: "打开终端",
                    Icon: TerminalSquare,
                    run: () => workbench.open("terminal"),
                  },
                  {
                    label: "知识助手",
                    Icon: Sparkles,
                    run: () => workbench.open("agent"),
                  },
                ].map(({ label, Icon, run }) => (
                  <button key={label} onClick={run}>
                    <Icon size={15} />
                    <span>{label}</span>
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </nav>
              <section className="home-pinned" aria-label="星标速达">
                <h2>
                  <Pin size={13} />
                  星标速达
                </h2>
                {pinned.length ? (
                  pinned.map((note) => (
                    <button
                      key={note.id}
                      onClick={() =>
                        workbench.open("document", note.id, note.title)
                      }
                    >
                      <Pin size={12} />
                      <span>{note.title || "未命名笔记"}</span>
                      <ArrowUpRight size={12} />
                    </button>
                  ))
                ) : (
                  <p className="home-empty">
                    给常用笔记加上星标，
                    <br />
                    下次从这里继续。
                  </p>
                )}
              </section>
              <section className="home-recent" aria-label="最近编辑">
                <h2>
                  <Clock3 size={13} />
                  最近编辑
                </h2>
                {recent.length ? (
                  recent.map((note) => (
                    <button
                      className="home-note"
                      key={note.id}
                      onClick={() =>
                        workbench.open("document", note.id, note.title)
                      }
                    >
                      <span>{note.title || "未命名笔记"}</span>
                      <time>
                        {dateKey(note.updatedAt).slice(5).replace("-", "/")}
                      </time>
                    </button>
                  ))
                ) : (
                  <p className="home-empty">从第一条记录开始。</p>
                )}
              </section>
              <p className="home-aside-note">一点一滴，都是思考的痕迹。</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
