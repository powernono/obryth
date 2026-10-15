import { useEffect, useState } from "react";
import type { Note } from "@obryth/contracts";
import { bridge, safeMessage } from "../lib/bridge";
import { useWorkbench } from "../lib/workbench";
type Proposal = {
  id: string;
  noteId: string;
  baseRevision: string;
  body: string;
  current?: Note;
};
export function ProposalReview() {
  const workbench = useWorkbench();
  const [items, setItems] = useState<Proposal[]>([]);
  const [error, setError] = useState("");
  const load = async () => {
    const proposals = await bridge.call<Proposal[]>("knowledge.proposals");
    setItems(
      await Promise.all(
        proposals.map(async (item) => ({
          ...item,
          current: await bridge
            .call<Note>("notes.get", { id: item.noteId })
            .catch(() => undefined),
        })),
      ),
    );
  };
  useEffect(() => {
    void load().catch((error) => setError(safeMessage(error)));
  }, []);
  return (
    <>
      <h3>AI 变更审阅 · {items.length}</h3>
      <p>
        知识工具只提交建议。接受前会检查原笔记版本，已过期的建议需要重新合并。
      </p>
      {items.map((item) => (
        <article className="sync-conflict" key={item.id}>
          <strong>{item.current?.title ?? "笔记已删除"}</strong>
          {item.current?.revision !== item.baseRevision && (
            <p className="error-message">笔记版本已变化，无法直接应用。</p>
          )}
          <div className="conflict-versions">
            <pre>{item.current?.body ?? "笔记不可用"}</pre>
            <pre>{item.body}</pre>
          </div>
          <button
            disabled={item.current?.revision !== item.baseRevision}
            onClick={() =>
              void bridge
                .call("knowledge.review", { id: item.id, accept: true })
                .then(async () => {
                  await load();
                  await workbench.refresh();
                })
                .catch((error) => setError(safeMessage(error)))
            }
          >
            接受修改
          </button>
          <button
            onClick={() =>
              void bridge
                .call("knowledge.review", { id: item.id, accept: false })
                .then(load)
                .catch((error) => setError(safeMessage(error)))
            }
          >
            拒绝
          </button>
        </article>
      ))}
      {error && <p className="inline-error">{error}</p>}
    </>
  );
}
