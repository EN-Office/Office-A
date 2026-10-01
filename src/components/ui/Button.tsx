import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
}

export function Button({ variant = "outline", size = "md", icon, iconRight, className = "", children, type = "button", ...rest }: ButtonProps) {
  const iconSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;
  return (
    <button type={type} className={`ui-btn ui-btn--${variant} ui-btn--${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children != null && <span className="ui-btn__label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: Size;
  variant?: "ghost" | "danger" | "outline";
}

export function IconButton({ icon, label, size = "md", variant = "ghost", className = "", type = "button", ...rest }: IconButtonProps) {
  const iconSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;
  return (
    <button type={type} aria-label={label} title={label} className={`ui-iconbtn ui-iconbtn--${variant} ui-iconbtn--${size} ${className}`} {...rest}>
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
