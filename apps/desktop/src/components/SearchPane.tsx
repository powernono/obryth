import { useEffect, useState } from "react";
import { Search, ArrowUpRight, FileText } from "lucide-react";
import type { SearchHit } from "@obryth/contracts";
import { bridge, safeMessage } from "../lib/bridge";
import { useWorkbench } from "../lib/workbench";
export function SearchPane() {
  const workbench = useWorkbench();
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        void bridge
          .call<SearchHit[]>("knowledge.search", {
            text: query,
            scope: {
              includeTags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              excludeTags: [],
            },
            limit: 100,
          })
          .then((value) => {
            if (active) {
              setHits(value);
              setError("");
            }
          })
          .catch((error) => active && setError(safeMessage(error))),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, tags, workbench.notes]);
  return (
    <div className="search-pane">
      <div className="section-heading">
        <Search size={22} />
        <h2>在知识中寻找线索</h2>
        <p>搜索正文、标题与标签，找到值得连接的想法。</p>
      </div>
      <label className="search-field">
        <Search size={16} />
        <input
          autoFocus
          aria-label="搜索知识库"
          placeholder="搜索你的笔记…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>⌘ K</kbd>
      </label>
      <input
        className="tag-filter"
        aria-label="筛选标签"
        value={tags}
        placeholder="包含标签，使用英文逗号分隔"
        onChange={(event) => setTags(event.target.value)}
      />
      {error && <p className="error-message">{error}</p>}
      <div className="result-count">{hits.length} 条记录</div>
      {hits.map((hit) => (
        <button
          className="search-result"
          key={hit.note.id}
          onClick={() =>
            workbench.open("document", hit.note.id, hit.note.title)
          }
        >
          <FileText size={17} />
          <div>
            <h3>{hit.note.title}</h3>
            <p>{hit.excerpt}</p>
            <span>
              {hit.note.tags.map((t) => `#${t}`).join("  ")} · 第 {hit.line} 行
            </span>
          </div>
          <ArrowUpRight size={15} />
        </button>
      ))}
    </div>
  );
}
