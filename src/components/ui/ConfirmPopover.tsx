import { useCallback, useRef, useState, type ReactNode } from "react";
import { Popover } from "./Popover";
import { Button } from "./Button";

export interface ConfirmPopoverProps {
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  /** トリガー描画。open を呼ぶと確認ポップオーバーが開く */
  children: (open: () => void) => ReactNode;
  align?: "start" | "end";
}

/** 削除などのインライン確認 */
export function ConfirmPopover({ message, confirmLabel = "削除", onConfirm, children, align = "end" }: ConfirmPopoverProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <span ref={anchor} className="ui-confirm-anchor">{children(() => setOpen(true))}</span>
      <Popover anchor={anchor} open={open} onClose={close} align={align} className="ui-confirm">
        <p className="ui-confirm__msg">{message}</p>
        <div className="ui-confirm__actions">
          <Button size="sm" variant="ghost" onClick={close}>キャンセル</Button>
          <Button size="sm" variant="danger" onClick={() => { close(); onConfirm(); }}>{confirmLabel}</Button>
        </div>
      </Popover>
    </>
  );
}
