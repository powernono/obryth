import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type AstNode = {
  type: string;
  children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
const supported = new Set([
  "root",
  "paragraph",
  "heading",
  "text",
  "emphasis",
  "strong",
  "delete",
  "link",
  "image",
  "inlineCode",
  "break",
  "list",
  "listItem",
  "blockquote",
  "code",
  "thematicBreak",
  "table",
  "tableRow",
  "tableCell",
]);
export class MarkdownCodec {
  private raw = new Map<string, string>();
  private original = "";
  private initialDocument = "";
  parse(source: string): string {
    this.original = source;
    this.raw.clear();
    this.initialDocument = "";
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .parse(source) as AstNode;
    let cursor = 0;
    let result = "";
    const safe = (node: AstNode): boolean =>
      supported.has(node.type) && (node.children?.every(safe) ?? true);
    for (const node of tree.children ?? []) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined)
        throw new Error("Markdown parser returned no source positions");
      result += source.slice(cursor, start);
      if (safe(node)) result += source.slice(start, end);
      else {
        const id = `raw-${this.raw.size}`;
        this.raw.set(id, source.slice(start, end));
        result += `\`\`\`obryth-opaque\n${id}\n\`\`\``;
      }
      cursor = end;
    }
    return result + source.slice(cursor);
  }
  baseline(document: unknown) {
    this.initialDocument = JSON.stringify(document);
  }
  serialize(markdown: string, document?: unknown): string {
    if (
      document !== undefined &&
      JSON.stringify(document) === this.initialDocument
    )
      return this.original;
    return this.restore(markdown);
  }
  restore(markdown: string): string {
    const found = [
      ...markdown.matchAll(/```obryth-opaque\s*\n(raw-\d+)\s*\n```/g),
    ].map((match) => match[1]);
    if (
      [...this.raw.keys()].some(
        (id) => found.filter((value) => value === id).length !== 1,
      )
    )
      throw new Error(
        "原文区块被更改。请撤销该操作，或切换源码模式编辑；当前文档改动尚未保存。",
      );
    return markdown.replace(
      /```obryth-opaque\s*\n(raw-\d+)\s*\n```/g,
      (_block, id: string) => {
        const raw = this.raw.get(id);
        if (raw === undefined)
          throw new Error("Unknown protected Markdown block");
        return raw;
      },
    );
  }
  get protectedBlocks() {
    return this.raw.size;
  }
}
