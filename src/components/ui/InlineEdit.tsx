import { useEffect, useRef, useState } from "react";

export interface InlineEditProps {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  /** 空文字のコミットを許可するか */
  allowEmpty?: boolean;
  label?: string;
  /** 初回描画時に編集状態で開始 */
  autoEdit?: boolean;
}

/** クリックで入力欄に切り替わるテキスト。blur / Enter で確定、Esc で取消 */
export function InlineEdit({ value, onCommit, placeholder = "—", className = "", mono, allowEmpty, label, autoEdit }: InlineEditProps) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (!allowEmpty && !v) return setDraft(value);
    if (v !== value) onCommit(v);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        className={`ui-inline ui-inline--editing ${mono ? "num" : ""} ${className}`}
        value={draft}
        aria-label={label}
        size={Math.max(4, draft.length + 2)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={`ui-inline ${mono ? "num" : ""} ${value ? "" : "is-empty"} ${className}`}
      title="クリックで編集"
      aria-label={label ? `${label}を編集` : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      {value || placeholder}
    </button>
  );
}
