import { createContext, useContext } from "react";
import type { Note, PaneKind, KnowledgeScope } from "@obryth/contracts";
export type WorkspaceSurface =
  "workspace" | "knowledge" | "plugins" | "browser";
export interface Workbench {
  notes: Note[];
  selectedId: string | null;
  refresh: () => Promise<void>;
  open: (kind: PaneKind, id?: string, title?: string) => void;
  notify: (text: string) => void;
  overlay: boolean;
  surface: WorkspaceSurface;
  activePaneKind: string;
  scope: KnowledgeScope;
}
export const WorkbenchContext = createContext<Workbench | null>(null);
export function useWorkbench() {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("Workbench provider missing");
  return context;
}
