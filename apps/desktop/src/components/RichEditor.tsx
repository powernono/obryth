import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Quote,
  Heading2,
  Table2,
  Undo2,
  Redo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownCodec } from "../lib/markdown-codec";

export function RichEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const codec = useRef(new MarkdownCodec());
  const [codecError, setCodecError] = useState("");
  const initial = useRef(codec.current.parse(value));
  const callback = useRef(onChange);
  callback.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initial.current,
    contentType: "markdown",
    editorProps: { attributes: { class: "prose-editor", spellcheck: "false" } },
    onCreate: ({ editor }) => codec.current.baseline(editor.getJSON()),
    onUpdate: ({ editor }) => {
      try {
        const text = codec.current.serialize(
          editor.getMarkdown(),
          editor.getJSON(),
        );
        setCodecError("");
        callback.current(text);
      } catch (error) {
        setCodecError(String(error));
      }
    },
  });
  const received = useRef(value);
  useEffect(() => {
    if (editor && value !== received.current) {
      const current = codec.current.serialize(
        editor.getMarkdown(),
        editor.getJSON(),
      );
      if (current !== value) {
        const protectedText = codec.current.parse(value);
        editor.commands.setContent(protectedText, {
          contentType: "markdown",
          emitUpdate: false,
        });
        codec.current.baseline(editor.getJSON());
      }
    }
    received.current = value;
  }, [value, editor]);
  if (!editor) return null;
  const tools = [
    {
      label: "二级标题",
      icon: Heading2,
      active: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "粗体",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "无序列表",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "引用",
      icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "代码块",
      icon: Code,
      active: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "插入表格",
      icon: Table2,
      active: false,
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
  ];
  return (
    <div className="rich-editor">
      <div className="format-toolbar">
        {tools.map((tool) => (
          <button
            key={tool.label}
            aria-label={tool.label}
            title={tool.label}
            className={tool.active ? "active" : ""}
            onClick={tool.run}
          >
            <tool.icon size={15} />
          </button>
        ))}
        <span className="toolbar-spacer" />
        <button
          aria-label="撤销"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={15} />
        </button>
        <button
          aria-label="重做"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={15} />
        </button>
      </div>
      {codecError && (
        <div className="conflict-banner" role="alert">
          {codecError}
        </div>
      )}
      <EditorContent editor={editor} />
      {codec.current.protectedBlocks > 0 && (
        <div className="protected-hint">
          原文区块已保留 · 可在源码模式编辑 HTML / 数学公式等内容
        </div>
      )}
    </div>
  );
}
