export * from "./generated";
export interface RpcBridge {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}
export interface AgentSession {
  id: string;
  title: string;
  agent: string;
  kind: string;
  status: string;
  workspace: string;
  model?: string;
  updatedAt: number;
}
export interface TerminalPage {
  nextSeq: number;
  floorSeq: number;
  resyncRequired: boolean;
  events: (
    | { type: "output"; dataB64: string }
    | { type: "resize"; size: { cols: number; rows: number } }
  )[];
  exited: boolean;
  exitCode: number | null;
}
export type PaneKind =
  "document" | "markdown" | "terminal" | "agent" | "browser" | "search";
export const EMPTY_SCOPE = {
  includeTags: [] as string[],
  excludeTags: [] as string[],
};
