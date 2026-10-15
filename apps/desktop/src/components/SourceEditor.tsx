import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";

export function SourceEditor({
  value,
  onChange,
  vimMode = false,
}: {
  value: string;
  onChange: (value: string) => void;
  vimMode?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          keymap.of([indentWithTab]),
          ...(vimMode ? [vim()] : []),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "transparent",
              color: "var(--text)",
            },
            ".cm-scroller": {
              fontFamily: "var(--mono)",
              fontSize: "14px",
              lineHeight: "1.9",
              overflow: "auto",
            },
            ".cm-content": {
              padding: "16px 0 80px",
              caretColor: "var(--accent)",
            },
            ".cm-gutters": {
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              padding: "0",
            },
            ".cm-line": { paddingLeft: "8px", paddingRight: "16px" },
            ".cm-lineNumbers .cm-gutterElement": {
              padding: "0 4px",
              minWidth: "20px",
            },
            ".cm-foldGutter .cm-gutterElement": {
              width: "14px",
              padding: "0",
              textAlign: "center",
            },
            ".cm-activeLine,.cm-activeLineGutter": {
              background: "var(--hover)",
            },
            ".cm-cursor": { borderLeftColor: "var(--accent)" },
            ".cm-selectionBackground": {
              background: "var(--selection) !important",
            },
            "&.cm-focused": { outline: "none" },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [vimMode]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  return <div className="source-editor" ref={host} />;
}
