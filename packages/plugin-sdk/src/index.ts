import type { Note, KnowledgeScope } from "@obryth/contracts";
export type Permission =
  "notes.read" | "notes.propose" | "commands" | "panels" | "network";
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  platforms: ("desktop" | "mobile" | "tui")[];
  permissions: Permission[];
  entry: string;
  networkHosts?: string[];
}
export interface PluginContext {
  manifest: PluginManifest;
  registerCommand(command: {
    id: string;
    title: string;
    run: () => void | Promise<void>;
  }): () => void;
  search(query: string, scope: KnowledgeScope): Promise<Note[]>;
  propose(noteId: string, baseRevision: string, body: string): Promise<string>;
  notify(message: string): void;
  registerPanel(panel: { id: string; title: string; html: string }): void;
  openPanel(id: string): void;
  fetch(url: string): Promise<{ status: number; body: string }>;
}
export interface ObrythPlugin {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
export function validateManifest(value: unknown): PluginManifest {
  const m = value as Partial<PluginManifest>;
  if (
    m.apiVersion !== 1 ||
    !m.id?.match(/^[a-z0-9]+([.-][a-z0-9]+)*$/) ||
    !m.name ||
    !m.version ||
    !m.entry ||
    m.entry.startsWith("/") ||
    m.entry.split(/[\\/]/).includes("..") ||
    !Array.isArray(m.permissions) ||
    !Array.isArray(m.platforms)
  )
    throw new Error("Invalid Obryth plugin manifest");
  const permissions: Permission[] = [
    "notes.read",
    "notes.propose",
    "commands",
    "panels",
    "network",
  ];
  if (m.permissions.some((p) => !permissions.includes(p)))
    throw new Error("Unknown plugin permission");
  return m as PluginManifest;
}
