import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import type { Assignment, DB, MonthKey, Project } from "@shared/types";
import { isWithin } from "@shared/types";
import { clampHours, hoursPerMonthOf, hoursRange, hoursToRatio, ratioToHours } from "../../lib/store";
import { fmtHours, projectActiveIn } from "./helpers";

export interface Anchor { left: number; top: number; right: number; bottom: number }

export function rectOf(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function useFloating(anchor: Anchor, width: number, estH: number, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? estH;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
    let top = anchor.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor, width, estH]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return { ref, pos };
}

/** クイック工数（1人月時間に対する割合）。80h / 160h（既定）を主ボタン、40h / 120h を補助ボタンにする */
const QUICK_MAIN = [0.5, 1];
const QUICK_SUB = [0.25, 0.75];

/**
 * 工数（時間）入力。入力のたびに有効な値ならコミットし（ポップオーバーを外クリックで閉じても失われない）、
 * Enter / blur で範囲内に丸めて表示を確定する。
 */
function HoursInput({ id, value, min, max, onCommit }: { id: string; value: number; min: number; max: number; onCommit: (h: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const parse = (s: string) => {
    const n = Number(s.normalize("NFKC").replace(/[^\d.]/g, ""));
    return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
  };
  const finish = () => {
    setEditing(false);
    const n = parse(draft);
    if (n != null) onCommit(Math.min(max, Math.max(min, n)));
    else setDraft(String(value));
  };
  return (
    <label className="sch-hours ui-field ui-field--num">
      <input
        id={id}
        className="ui-input num"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={10}
        value={editing ? draft : String(value)}
        aria-label="工数 (h)"
        onFocus={(e) => { setEditing(true); setDraft(String(value)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parse(e.target.value);
          if (n != null && n >= min && n <= max) onCommit(n);
        }}
        onBlur={finish}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <span className="ui-field__suffix">h</span>
    </label>
  );
}

interface PopProps {
  anchor: Anchor;
  assignment: Assignment;
  db: DB;
  months: MonthKey[];
  onClose: () => void;
  update: (id: string, patch: Partial<Omit<Assignment, "id">>) => void;
  remove: (id: string) => void;
  range: (input: { months: MonthKey[]; memberId: string; projectId: string; statusId?: string; ratio?: number }) => void;
}

export function AssignmentPopover({ anchor, assignment: a, db, months, onClose, update, remove, range }: PopProps) {
  const { ref, pos } = useFloating(anchor, 300, 360, onClose);
  const project = db.projects.find((p) => p.id === a.projectId);
  const member = db.members.find((m) => m.id === a.memberId);
  const [n, setN] = useState(2);
  if (!project) return null;
  const idx = months.indexOf(a.month);
  const maxN = Math.max(0, months.length - 1 - idx);
  const nn = Math.min(n, Math.max(1, maxN));
  const inPeriod = months.filter((m) => isWithin(m, project.startMonth, project.endMonth));
  const hpm = hoursPerMonthOf(db);
  const hours = ratioToHours(a.ratio, hpm);
  const { min: hMin, max: hMax } = hoursRange(hpm);
  const setHours = (h: number) => update(a.id, { ratio: hoursToRatio(clampHours(h, hpm), hpm) });
  const quickBtn = (q: number, main: boolean) => {
    const h = ratioToHours(q, hpm);
    return (
      <button
        key={q}
        type="button"
        className={`${main ? "sch-quick-main" : "sch-quick-sub"} ${hours === h ? "is-on" : ""}`}
        data-hours={h}
        onClick={() => setHours(h)}
      >
        <b className="sch-mono">{fmtHours(h)}</b>
      </button>
    );
  };

  return createPortal(
    <motion.div
      ref={ref}
      className="sch-pop"
      style={{ left: pos.left, top: pos.top }}
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="sch-pop-head">
        <span className="sch-pop-swatch" style={{ background: project.color }} />
        <div className="sch-pop-title">
          <span className="sch-mono">{project.code}</span> {project.name}
        </div>
        <button className="sch-pop-x" onClick={onClose} aria-label="閉じる">×</button>
      </div>
      <div className="sch-pop-sub">
        {member?.name} · <span className="sch-mono">{a.month}</span>
      </div>

      <label className="sch-pop-label" htmlFor={`sch-hours-${a.id}`}>
        工数 (h) <span className="sch-mono sch-pop-derived">= {Math.round(a.ratio * 1000) / 10}%</span>
      </label>
      <HoursInput id={`sch-hours-${a.id}`} value={hours} min={hMin} max={hMax} onCommit={setHours} />
      <div className="sch-quick">{QUICK_MAIN.map((q) => quickBtn(q, true))}</div>
      <div className="sch-quick sch-quick--sub">{QUICK_SUB.map((q) => quickBtn(q, false))}</div>
      <p className="sch-pop-note">{hpm}h = 1人月 · 上限 {hMax}h（残業込み）</p>

      <label className="sch-pop-label">役割</label>
      <select
        className="sch-select"
        value={a.statusId ?? ""}
        onChange={(e) => update(a.id, { statusId: e.target.value || undefined })}
      >
        <option value="">未設定</option>
        {[...db.roleStatuses].sort((x, y) => x.order - y.order).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <div className="sch-pop-actions">
        <button
          className="sch-btn"
          disabled={inPeriod.length === 0}
          onClick={() => {
            range({ months: inPeriod, memberId: a.memberId, projectId: a.projectId, statusId: a.statusId, ratio: a.ratio });
            onClose();
          }}
        >
          期間塗り: この案件の契約期間すべてに適用
        </button>
        <div className="sch-step-row">
          <span>右へ</span>
          <button className="sch-step" onClick={() => setN(Math.max(1, nn - 1))} aria-label="減らす">−</button>
          <b className="sch-mono">{nn}</b>
          <button className="sch-step" onClick={() => setN(Math.min(Math.max(1, maxN), nn + 1))} aria-label="増やす">＋</button>
          <span>ヶ月コピー</span>
          <button
            className="sch-btn sch-btn-sm"
            disabled={maxN === 0}
            onClick={() => {
              range({
                months: months.slice(idx + 1, idx + 1 + nn),
                memberId: a.memberId,
                projectId: a.projectId,
                statusId: a.statusId,
                ratio: a.ratio,
              });
              onClose();
            }}
          >
            実行
          </button>
        </div>
        <button
          className="sch-btn sch-btn-danger"
          onClick={() => {
            remove(a.id);
            onClose();
          }}
        >
          このアサインを削除
        </button>
      </div>
    </motion.div>,
    document.body,
  );
}

interface PickerProps {
  anchor: Anchor;
  db: DB;
  months: MonthKey[];
  memberName: string;
  month: MonthKey;
  onPick: (p: Project) => void;
  onClose: () => void;
}

export function QuickPicker({ anchor, db, months, memberName, month, onPick, onClose }: PickerProps) {
  const { ref, pos } = useFloating(anchor, 280, 320, onClose);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return db.projects
      .filter((p) => !t || p.code.toLowerCase().includes(t) || p.name.toLowerCase().includes(t))
      .sort((a, b) => Number(projectActiveIn(b, months)) - Number(projectActiveIn(a, months)) || a.code.localeCompare(b.code));
  }, [db.projects, q, months]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return createPortal(
    <motion.div
      ref={ref}
      className="sch-pop sch-picker"
      style={{ left: pos.left, top: pos.top }}
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="sch-pop-sub" style={{ marginTop: 0 }}>
        {memberName} · <span className="sch-mono">{month}</span> に追加
      </div>
      <input
        ref={inputRef}
        className="sch-input"
        placeholder="案件を検索…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="sch-picker-list">
        {list.length === 0 && <div className="sch-empty-s">該当する案件がありません</div>}
        {list.map((p) => {
          const within = isWithin(month, p.startMonth, p.endMonth);
          return (
            <button key={p.id} className="sch-picker-item" onClick={() => onPick(p)}>
              <span className="sch-chip-bar" style={{ background: p.color }} />
              <span className="sch-mono sch-picker-code">{p.code}</span>
              <span className="sch-picker-name">{p.name}</span>
              {!within && <span className="sch-picker-out">期間外</span>}
            </button>
          );
        })}
      </div>
    </motion.div>,
    document.body,
  );
}
