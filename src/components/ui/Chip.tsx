import type { ReactNode } from "react";
import { Icon } from "./Icon";

export interface ChipProps {
  color?: string;
  children: ReactNode;
  count?: ReactNode;
  onRemove?: () => void;
  variant?: "soft" | "outline" | "solid";
  title?: string;
  className?: string;
}

export function Chip({ color, children, count, onRemove, variant = "soft", title, className = "" }: ChipProps) {
  return (
    <span className={`ui-chip ui-chip--${variant} ${className}`} style={color ? ({ "--chip": color } as React.CSSProperties) : undefined} title={title}>
      {color && <span className="ui-chip__dot" />}
      <span className="ui-chip__label">{children}</span>
      {count != null && <span className="ui-chip__count num">{count}</span>}
      {onRemove && (
        <button type="button" className="ui-chip__x" aria-label="削除" onClick={onRemove}>
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}
