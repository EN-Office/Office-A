import { useCallback, useRef, useState } from "react";
import { Popover } from "./Popover";
import { Icon } from "./Icon";

/** キュレーションしたパレット（紙・インクに馴染む彩度） */
export const PALETTE = [
  "#e4572e", "#f3a712", "#d9a300", "#76b041", "#2e8b57", "#17bebb",
  "#2f6fab", "#3b4a6b", "#7b5ea7", "#c2477f", "#8a6a4f", "#1d1d1f",
];

export function ColorSwatches({ value, onChange, colors = PALETTE }: { value: string; onChange: (c: string) => void; colors?: string[] }) {
  return (
    <div className="ui-swatches" role="radiogroup" aria-label="色">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          aria-label={c}
          className="ui-swatch"
          style={{ "--sw": c } as React.CSSProperties}
          onClick={() => onChange(c)}
        >
          {c.toLowerCase() === value.toLowerCase() && <Icon name="check" size={12} />}
        </button>
      ))}
    </div>
  );
}

/** 色ドット。クリックでパレットのポップオーバー */
export function ColorSwatch({ value, onChange, size = 14, label = "色を変更" }: { value: string; onChange: (c: string) => void; size?: number; label?: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="ui-swatch-dot"
        aria-label={label}
        title={label}
        style={{ "--sw": value, width: size, height: size } as React.CSSProperties}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover anchor={anchor} open={open} onClose={close} align="start" className="ui-swatch-pop">
        <ColorSwatches value={value} onChange={(c) => { onChange(c); close(); }} />
      </Popover>
    </>
  );
}
