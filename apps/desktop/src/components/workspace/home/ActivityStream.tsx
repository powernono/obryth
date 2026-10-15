import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, History, PenLine } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ActivityCard,
  ActivityFeed,
  ActivityQuery,
  ActivityVersions,
} from "@obryth/contracts";
import { bridge, safeMessage } from "../../../lib/bridge";
import { useWorkbench } from "../../../lib/workbench";
import { activityKinds, shiftDay } from "../../../lib/activity";

function Markdown({ body }: { body: string }) {
  return (
    <div className="activity-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            src?.startsWith("https:") || src?.startsWith("data:image/") ? (
              <img src={src} alt={alt ?? "笔记图片"} loading="lazy" />
            ) : (
              <span className="activity-attachment">附件：{alt || src}</span>
            ),
        }}
      >
        {body || "*空白笔记*"}
      </ReactMarkdown>
    </div>
  );
}

function VersionList({
  card,
  range,
}: {
  card: ActivityCard;
  range: ActivityQuery;
}) {
  const [pages, setPages] = useState(1);
  const [data, setData] = useState<ActivityVersions | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    (async () => {
      let cursor: string | null = null;
      const items: ActivityVersions["items"] = [];
      for (let i = 0; i < pages; i++) {
        const page: ActivityVersions = await bridge.call(
          "notes.activityVersions",
          {
            range: { ...range, from: card.day, to: shiftDay(card.day, 1) },
            noteId: card.noteId,
            cursor,
            limit: 20,
          },
        );
        items.push(...page.items);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      if (current) setData({ items, nextCursor: cursor });
    })()
      .catch((e) => {
        if (current) setError(safeMessage(e));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [pages, retry, card.revisionId, card.saveCount]);
  return (
    <div className="activity-versions" aria-label="当天保存版本">
      {data?.items.map((version) => (
        <details key={version.id}>
          <summary>
            <time>
              {new Date(version.timestamp).toLocaleTimeString("zh-CN", {
                hour12: false,
              })}
            </time>
            <span>{version.note.title || "未命名笔记"}</span>
            <ChevronDown size={12} />
          </summary>
          <Markdown body={version.note.body} />
        </details>
      ))}
      {busy && (
        <p className="home-empty" role="status">
          正在读取版本…
        </p>
      )}
      {error && (
        <div className="home-error" role="alert">
          读取版本失败：{error}
          <button onClick={() => setRetry((n) => n + 1)}>重试</button>
        </div>
      )}
      {data?.nextCursor && (
        <button
          className="activity-load-more"
          disabled={busy}
          onClick={() => setPages((n) => n + 1)}
        >
          更多保存版本
        </button>
      )}
    </div>
  );
}

function RecordCard({
  card,
  range,
}: {
  card: ActivityCard;
  range: ActivityQuery;
}) {
  const workbench = useWorkbench();
  const [expanded, setExpanded] = useState(false);
  const [versions, setVersions] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollHeight > 241);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [card.revisionId]);
  const type =
    activityKinds.find((item) => item.value === card.note.kind)?.label ??
    "笔记";
  return (
    <article className="activity-card" data-note-id={card.noteId}>
      <header>
        <span className="activity-kind">
          <PenLine size={12} />
          {type}
        </span>
        <time dateTime={card.lastSavedAt}>
          {new Date(card.lastSavedAt).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </time>
        {card.deleted && <span className="activity-deleted">已删除</span>}
      </header>
      {card.note.kind !== "memo" && <h3>{card.note.title || "未命名笔记"}</h3>}
      <div ref={body} className={`activity-body ${expanded ? "expanded" : ""}`}>
        <Markdown body={card.note.body} />
      </div>
      {(overflows || expanded) && (
        <button
          className="activity-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起正文" : "展开全文"}
          <ChevronDown size={12} />
        </button>
      )}
      {card.note.tags.length > 0 && (
        <div className="activity-tags">
          {card.note.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      )}
      <footer>
        <button
          className="activity-version-toggle"
          aria-expanded={versions}
          onClick={() => setVersions((v) => !v)}
        >
          <History size={13} />
          保存 {card.saveCount} 次<ChevronDown size={11} />
        </button>
        {!card.deleted && (
          <button
            className="activity-open"
            onClick={() =>
              workbench.open("document", card.noteId, card.note.title)
            }
          >
            打开笔记
            <ArrowUpRight size={13} />
          </button>
        )}
      </footer>
      {versions && <VersionList card={card} range={range} />}
    </article>
  );
}

export function ActivityStream({
  range,
  refreshKey,
}: {
  range: ActivityQuery;
  refreshKey: number;
}) {
  const workbench = useWorkbench();
  const rangeKey = JSON.stringify(range);
  const [pagination, setPagination] = useState({ key: rangeKey, pages: 1 });
  const pages = pagination.key === rangeKey ? pagination.pages : 1;
  const [result, setResult] = useState<{
    key: string;
    range: ActivityQuery;
    data: ActivityFeed;
  } | null>(null);
  const data = result?.data;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const stream = useRef<HTMLElement>(null);
  const [minHeight, setMinHeight] = useState(180);
  const stale = !!result && result.key !== rangeKey;
  useLayoutEffect(() => {
    const element = stream.current;
    const home = element?.closest(".home-pane");
    if (!element || !home) return;
    // Keep the current viewport in place even when the new day has few records.
    // Reserve only the visible space, not the height of the previous full feed.
    setMinHeight(
      Math.max(
        180,
        home.getBoundingClientRect().bottom -
          element.getBoundingClientRect().top,
      ),
    );
  }, [rangeKey]);
  useEffect(() => {
    let current = true;
    setPagination((value) =>
      value.key === rangeKey ? value : { key: rangeKey, pages: 1 },
    );
    setBusy(true);
    setError("");
    (async () => {
      let cursor: string | null = null;
      const items: ActivityCard[] = [];
      for (let i = 0; i < pages; i++) {
        const page: ActivityFeed = await bridge.call("notes.activityFeed", {
          range,
          cursor,
          limit: 20,
          noteId: null,
        });
        if (!current) return;
        items.push(...page.items);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      if (current)
        setResult({
          key: rangeKey,
          range,
          data: { items, nextCursor: cursor },
        });
    })()
      .catch((e) => {
        if (current) setError(safeMessage(e));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [
    rangeKey,
    pages,
    retry,
    refreshKey,
    workbench.notes,
    workbench.activePaneKind,
  ]);
  const groups = new Map<string, ActivityCard[]>();
  data?.items.forEach((item) => {
    const group = groups.get(item.day) ?? [];
    group.push(item);
    groups.set(item.day, group);
  });
  return (
    <section
      ref={stream}
      className="activity-stream"
      aria-label="保存记录流"
      aria-busy={busy || (stale && !error)}
      style={{ minHeight }}
    >
      {error && (
        <div className="home-error" role="alert">
          读取记录失败：{error}
          {stale && "（仍显示上次的记录）"}
          <button onClick={() => setRetry((n) => n + 1)}>重试</button>
        </div>
      )}
      {!data && busy && (
        <p className="home-empty" role="status">
          正在读取记录…
        </p>
      )}
      {data && busy && (
        <p className="activity-refresh-status" role="status">
          正在更新记录…
        </p>
      )}
      <div
        className="activity-stream-content"
        inert={stale}
        aria-hidden={stale || undefined}
      >
        {data && !data.items.length && !error && (
          <div className="activity-empty">
            <PenLine size={22} />
            <h3>这里还没有保存记录</h3>
            <p>在上方写下一个想法，或换一个日期、类型看看。</p>
          </div>
        )}
        {[...groups].map(([day, cards]) => (
          <section className="activity-day-group" key={day}>
            <h2>
              <time dateTime={day}>{day.replaceAll("-", ".")}</time>
              <span>
                {new Intl.DateTimeFormat("zh-CN", {
                  weekday: "long",
                  timeZone: "UTC",
                }).format(new Date(`${day}T12:00:00Z`))}
              </span>
            </h2>
            {cards.map((card) => (
              <RecordCard
                key={`${card.day}/${card.noteId}`}
                card={card}
                range={result!.range}
              />
            ))}
          </section>
        ))}
        {data?.nextCursor && (
          <button
            className="activity-load-more"
            disabled={busy || stale}
            onClick={() => setPagination({ key: rangeKey, pages: pages + 1 })}
          >
            {busy ? "正在读取…" : "加载更多记录"}
            <ChevronDown size={13} />
          </button>
        )}
        {data && data.items.length > 0 && !data.nextCursor && (
          <p className="activity-end">这一段时间的记录，都在这里了。</p>
        )}
      </div>
    </section>
  );
}
