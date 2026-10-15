import { describe, it, expect } from "vitest";
import { MarkdownCodec } from "./markdown-codec";
describe("portable Markdown", () => {
  it("rejects rich edits that remove or duplicate an opaque source block", () => {
    const codec = new MarkdownCodec();
    const protectedText = codec.parse("<custom-widget>keep</custom-widget>\n");
    expect(() => codec.restore("deleted")).toThrow("原文区块");
    expect(() => codec.restore(protectedText + "\n" + protectedText)).toThrow(
      "原文区块",
    );
  });
  it("preserves HTML, math, references and surrounding source verbatim", () => {
    const source =
      '# 中文\n\n<custom-widget value="x">keep</custom-widget>\n\n$$\nx^2\n$$\n\n[link][ref]\n\n[ref]: https://example.com\n';
    const codec = new MarkdownCodec();
    const protectedText = codec.parse(source);
    expect(codec.protectedBlocks).toBeGreaterThan(0);
    expect(codec.restore(protectedText)).toBe(source);
  });
  it("does not normalize an unchanged rich document on mode switches", () => {
    const codec = new MarkdownCodec();
    const source = "## Heading  \n\n* one\n* two\n\n";
    codec.parse(source);
    codec.baseline({ type: "doc", content: [] });
    expect(codec.serialize("normalized", { type: "doc", content: [] })).toBe(
      source,
    );
  });
  it("leaves supported tables and fenced code editable", () => {
    const codec = new MarkdownCodec();
    const source =
      "| A | B |\n|---|---|\n| 中文 | 42 |\n\n```rust\nfn main() {}\n```\n";
    expect(codec.parse(source)).toBe(source);
    expect(codec.protectedBlocks).toBe(0);
  });
});
