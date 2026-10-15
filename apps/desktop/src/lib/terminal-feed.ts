import { Channel, invoke } from "@tauri-apps/api/core";
import type { TerminalPage } from "@obryth/contracts";
/** One page is outstanding until xterm acknowledges that its write queue drained. */
export async function terminalFeed(id: string, afterSeq: number) {
  const streamId = crypto.randomUUID();
  let queued: { page?: TerminalPage; error?: string } | null = null;
  let waiting:
    ((message: { page?: TerminalPage; error?: string }) => void) | null = null;
  let closed = false;
  const channel = new Channel<
    { type: "page"; page: TerminalPage } | { type: "error"; message: string }
  >();
  channel.onmessage = (message) => {
    if (closed) return;
    const entry =
      message.type === "page"
        ? { page: message.page }
        : { error: message.message };
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(entry);
    } else queued = entry;
  };
  await invoke("terminal_watch", { id, streamId, afterSeq, channel });
  return {
    next: async () => {
      if (closed) throw new Error("Terminal subscription closed");
      const item =
        queued ??
        (await new Promise<{ page?: TerminalPage; error?: string }>(
          (resolve) => {
            waiting = resolve;
          },
        ));
      queued = null;
      if (item.error) throw new Error(item.error);
      return item.page!;
    },
    ack: () => invoke("terminal_ack", { streamId }),
    close: () => {
      closed = true;
      waiting?.({ error: "Terminal subscription closed" });
      waiting = null;
      void invoke("terminal_unwatch", { streamId });
    },
  };
}
