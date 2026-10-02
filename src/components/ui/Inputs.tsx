import { useEffect, useRef, useState, type InputHTMLAttributes, type Ref, type SelectHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

/* ---------- TextInput ---------- */
export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (v: string) => void;
  icon?: IconName;
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function TextInput({ value, onChange, icon, mono, className = "", ref, ...rest }: TextInputProps) {
  return (
    <label className={`ui-field ${icon ? "ui-field--icon" : ""} ${className}`}>
      {icon && <Icon name={icon} size={15} className="ui-field__icon" />}
      <input ref={ref} className={`ui-input ${mono ? "num" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}

/* ---------- NumberInput (¥ formatting) ---------- */
export interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  currency?: boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  "aria-label"?: string;
  id?: string;
}

const fmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });

export function NumberInput({ value, onChange, currency, min, max, step: _step, suffix, className = "", ...rest }: NumberInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) { cancelled.current = false; return; }
    const n = Number(draft.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n)) return setDraft(String(value));
    let v = min != null ? Math.max(min, n) : n;
    if (max != null) v = Math.min(max, v);
    if (v !== value) onChange(v);
  };

  return (
    <label className={`ui-field ui-field--num ${className}`}>
      {currency && <span className="ui-field__prefix num">¥</span>}
      <input
        className="ui-input num"
        inputMode={currency ? "numeric" : "decimal"}
        value={editing ? draft : (currency ? fmt : fmt1).format(value)}
        onFocus={(e) => { cancelled.current = false; setEditing(true); setDraft(String(value)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); cancelled.current = true; setDraft(String(value)); (e.target as HTMLInputElement).blur(); } }}
        {...rest}
      />
      {suffix && <span className="ui-field__suffix">{suffix}</span>}
    </label>
  );
}

/* ---------- Select ---------- */
export interface SelectOption { value: string; label: string; }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value" | "size"> {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  size?: "sm" | "md";
}

export function Select({ value, onChange, options, className = "", size = "md", ...rest }: SelectProps) {
  return (
    <span className={`ui-select ui-select--${size} ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" size={14} className="ui-select__chev" />
    </span>
  );
}

/* ---------- MonthInput ---------- */
export interface MonthInputProps {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  className?: string;
  "aria-label"?: string;
  id?: string;
}

export function MonthInput({ value, onChange, className = "", ...rest }: MonthInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [y, m] = value ? value.split("-") : ["", ""];
  return (
    <label
      className={`ui-field ui-month ${className}`}
      onClick={() => { try { ref.current?.showPicker?.(); } catch { /* not supported */ } }}
    >
      <span className="ui-month__face" aria-hidden>
        <span className="num ui-month__y">{y || "----"}</span>
        <span className="ui-month__sep">/</span>
        <span className="num ui-month__m">{m || "--"}</span>
        <span className="ui-month__unit">月</span>
      </span>
      <input ref={ref} type="month" className="ui-month__native" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} {...rest} />
    </label>
  );
}

/* ---------- Stepper ---------- */
export function Stepper({ value, onChange, min = 0, max = 99, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string }) {
  return (
    <span className="ui-stepper" aria-label={label}>
      <button type="button" aria-label="減らす" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" size={12} /></button>
      <span className="num ui-stepper__val">{value}</span>
      <button type="button" aria-label="増やす" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" size={12} /></button>
    </span>
  );
}
