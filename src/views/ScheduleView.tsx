import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AnimatePresence, motion } from "framer-motion";
import type { Assignment, MonthKey, Project } from "@shared/types";
import { fiscalMonths, flattenTree, isWithin, projectMonthCount } from "@shared/types";
import { contractTotal, hoursPerMonthOf, ratioToHours, selectProjectAssignedHours, selectRoleMap, selectStatusMap, useStore } from "../lib/store";
import { ChipBody } from "../components/schedule/Chip";
import { AssignmentPopover, QuickPicker, rectOf, type Anchor } from "../components/schedule/Popovers";
import {
  cellKey,
  currentMonthKey,
  fmtHours,
  fmtYen,
  indexAssignments,
  monthNum,
  projectActiveIn,
} from "../components/schedule/helpers";
import "../components/schedule/schedule.css";

/* ---------- ドラッグ可能なアサインチップ ---------- */

interface ChipProps {
  a: Assignment;
  hpm: number;
  project: Project;
  statusMap: ReturnType<typeof selectStatusMap>;
  onOpen: (a: Assignment, el: Element) => void;
  onFillStart: (e: React.PointerEvent, a: Assignment) => void;
}

const AssignmentChip = memo(function AssignmentChip({ a, hpm, project, statusMap, onOpen, onFillStart }: ChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `a:${a.id}`,
    data: { type: "chip", assignment: a },
  });
  const out = !isWithin(a.month, project.startMonth, project.endMonth);
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className="sch-chip-wrap"
    >
      <ChipBody
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        project={project}
        hours={ratioToHours(a.ratio, hpm)}
        status={a.statusId ? statusMap.get(a.statusId) : undefined}
        outOfRange={out}
        ghost={isDragging}
        onClick={(e) => onOpen(a, e.currentTarget)}
        handle={
          <span
            className="sch-handle"
            title="右へドラッグして期間塗り"
            onPointerDown={(e) => {
              e.stopPropagation();
              onFillStart(e, a);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        }
      />
    </motion.div>
  );
});

/* ---------- セル（ドロップターゲット） ---------- */

interface CellProps {
  memberId: string;
  month: MonthKey;
  mi: number;
  hpm: number;
  list: Assignment[];
  projectMap: Map<string, Project>;
  statusMap: ReturnType<typeof selectStatusMap>;
  filling: boolean;
  isNow: boolean;
  onOpen: (a: Assignment, el: Element) => void;
  onFillStart: (e: React.PointerEvent, a: Assignment) => void;
  onAdd: (memberId: string, month: MonthKey, el: Element) => void;
}

const Cell = memo(function Cell({
  memberId, month, mi, hpm, list, projectMap, statusMap, filling, isNow, onOpen, onFillStart, onAdd,
}: CellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `c:${cellKey(memberId, month)}`, data: { memberId, month } });
  const sum = list.reduce((s, a) => s + a.ratio, 0);
  const over = sum > 1.0001;
  return (
    <td className={`sch-td ${isNow ? "is-now" : ""}`}>
      <div
        ref={setNodeRef}
        className={`sch-cell ${isOver ? "is-over" : ""} ${filling ? "is-fill" : ""}`}
        data-sch-cell
        data-mid={memberId}
        data-mi={mi}
      >
        <AnimatePresence initial={false}>
          {list.map((a) => {
            const p = projectMap.get(a.projectId);
            if (!p) return null;
            return (
              <AssignmentChip key={a.id} a={a} hpm={hpm} project={p} statusMap={statusMap} onOpen={onOpen} onFillStart={onFillStart} />
            );
          })}
        </AnimatePresence>
        <button
          className="sch-add"
          aria-label="案件を追加"
          title="案件を追加"
          onClick={(e) => onAdd(memberId, month, e.currentTarget)}
        >
          ＋
        </button>
        {sum > 0 && (
          <span
            className={`sch-load ${over ? "is-over" : ""}`}
            style={{ width: `${Math.min(sum, 1) * 100}%` }}
            title={`稼働 ${fmtHours(ratioToHours(sum, hpm))}（${Math.round(sum * 100)}%）`}
          />
        )}
      </div>
    </td>
  );
});

/* ---------- パレット ---------- */

interface PaletteChipProps {
  p: Project;
  months: MonthKey[];
  open: boolean;
  onToggle: (id: string) => void;
  /** statusId → 案件期間の月平均アサイン時間（h/月） */
  assigned: Map<string, number> | undefined;
  statusMap: ReturnType<typeof selectStatusMap>;
}

function PaletteChip({ p, months, open, onToggle, assigned, statusMap }: PaletteChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `p:${p.id}`,
    data: { type: "palette", projectId: p.id },
  });
  const detailId = `sch-pal-detail-${p.id}`;
  return (
    <div className={`sch-pal-entry ${open ? "is-open" : ""}`}>
      <div ref={setNodeRef} {...attributes} {...listeners} className={`sch-pal-item ${isDragging ? "is-ghost" : ""}`}>
        <span className="sch-pal-bar" style={{ background: p.color }} />
        <div className="sch-pal-main">
          <div className="sch-pal-top">
            <span className="sch-mono sch-pal-code">{p.code}</span>
            <span className="sch-mono sch-pal-price" title="受注金額">{fmtYen(p.amount)}</span>
          </div>
          {/* 名前だけがクリック対象（詳細の開閉）。ポインタダウンを止めてドラッグ開始と分離する */}
          <button
            type="button"
            className="sch-pal-name"
            aria-expanded={open}
            aria-controls={detailId}
            title={open ? "詳細を閉じる" : "詳細を表示"}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle(p.id);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              // キーボード（Enter/Space）は onKeyDown で処理済み。detail=0 はキー由来のクリック
              if (e.detail !== 0) onToggle(p.id);
            }}
          >
            <span className="sch-pal-name-text">{p.name}</span>
            <motion.span
              className="sch-pal-chev"
              aria-hidden
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            >
              ▾
            </motion.span>
          </button>
          <div className="sch-pal-period" title={`${p.startMonth} 〜 ${p.endMonth}`}>
            {months.map((m) => (
              <i key={m} className={isWithin(m, p.startMonth, p.endMonth) ? "on" : ""} style={isWithin(m, p.startMonth, p.endMonth) ? { background: p.color } : undefined} />
            ))}
          </div>
          <div className="sch-mono sch-pal-range">{p.startMonth} → {p.endMonth}</div>
        </div>
        <span className="sch-grip" aria-hidden>⠿</span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={detailId}
            key="detail"
            className="sch-pal-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="sch-pal-detail-in">
              <dl className="sch-pal-facts">
                <div><dt>受注金額</dt><dd className="sch-mono">{fmtYen(p.amount)}</dd></div>
                <div><dt>期間</dt><dd className="sch-mono">{p.startMonth} → {p.endMonth}<small>{projectMonthCount(p) ?? "—"}ヶ月</small></dd></div>
              </dl>
              {p.required.length > 0 && (
                <div className="sch-pal-total">
                  <span>必要工数 計</span>
                  <b className="sch-mono">{fmtHours(p.required.reduce((s, r) => s + r.hoursPerMonth, 0))}<small>/月</small></b>
                </div>
              )}
              {p.required.length === 0 ? (
                <div className="sch-pal-noreq">必要役割 未設定</div>
              ) : (
                <ul className="sch-pal-roles">
                  {p.required.map((r) => {
                    const st = statusMap.get(r.statusId);
                    const got = assigned?.get(r.statusId) ?? 0;
                    const short = got + 1e-9 < r.hoursPerMonth;
                    return (
                      <li key={r.statusId} className={short ? "is-short" : "is-met"}>
                        <span className="sch-pal-role-n">
                          <i style={{ background: st?.color ?? "var(--ink-3)" }} />
                          <span>{st?.name ?? "?"}</span>
                          <span className="sch-mono sch-pal-role-c">{r.count}名</span>
                        </span>
                        <span className="sch-mono sch-pal-role-v" title={short ? `${fmtHours(r.hoursPerMonth - got)}/月 不足` : "充足"}>
                          必要 {fmtHours(r.hoursPerMonth)}<small>/月</small> · アサイン平均 {fmtHours(got)}<small>/月</small>
                        </span>
                        <span className="sch-pal-meter"><i style={{ width: `${r.hoursPerMonth > 0 ? Math.min(1, got / r.hoursPerMonth) * 100 : 100}%` }} /></span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="sch-pal-detail-note">アサイン平均 = 案件期間のアサイン時間合計 ÷ 案件の月数</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- 本体 ---------- */

type DragData =
  | { type: "palette"; projectId: string }
  | { type: "chip"; assignment: Assignment };

export default function ScheduleView() {
  const db = useStore((s) => s.db);
  const fiscalYear = useStore((s) => s.fiscalYear);
  const setFiscalYear = useStore((s) => s.setFiscalYear);
  const assign = useStore((s) => s.assign);
  const updateAssignment = useStore((s) => s.updateAssignment);
  const removeAssignment = useStore((s) => s.removeAssignment);
  const assignRange = useStore((s) => s.assignRange);

  const months = useMemo(() => fiscalMonths(fiscalYear, db.settings.fiscalYearStartMonth), [fiscalYear, db.settings.fiscalYearStartMonth]);
  const rows = useMemo(() => flattenTree(db.members), [db.members]);
  const projectMap = useMemo(() => new Map(db.projects.map((p) => [p.id, p])), [db.projects]);
  const roleMap = useMemo(() => selectRoleMap(db), [db]);
  const statusMap = useMemo(() => selectStatusMap(db), [db]);
  const cells = useMemo(() => indexAssignments(db, months), [db, months]);
  const nowKey = currentMonthKey();
  const hpm = hoursPerMonthOf(db);

  const stats = useMemo(() => {
    const monthSum = months.map(() => 0);
    const memberIds = new Set(db.members.map((m) => m.id));
    const memberYear = new Map<string, number>();
    let used = 0;
    let free = 0;
    for (const { member } of rows) {
      let y = 0;
      months.forEach((m, i) => {
        const list = cells.get(cellKey(member.id, m)) ?? [];
        const s = list.reduce((x, a) => x + a.ratio, 0);
        y += s;
        monthSum[i] += s;
        free += Math.max(0, hpm - ratioToHours(s, hpm));
      });
      memberYear.set(member.id, y);
      used += y;
    }
    void memberIds;
    const n = rows.length;
    return {
      monthSum,
      memberYear,
      contract: contractTotal(db, months),
      avg: n ? used / (n * 12) : 0,
      free,
    };
  }, [db, rows, months, cells, hpm]);

  /* パレット */
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1200); // 狭い画面ではパレットを畳んでマトリクスを優先
  const [filter, setFilter] = useState("");
  const palette = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return db.projects
      .filter((p) => projectActiveIn(p, months))
      .filter((p) => !t || p.code.toLowerCase().includes(t) || p.name.toLowerCase().includes(t))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [db.projects, months, filter]);
  const assignedHours = useMemo(() => selectProjectAssignedHours(db), [db]);
  /** 詳細を開いている案件（同時に 1 件だけ） */
  const [openPal, setOpenPal] = useState<string | null>(null);
  const togglePal = useCallback((id: string) => setOpenPal((cur) => (cur === id ? null : id)), []);

  /* DnD */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [active, setActive] = useState<DragData | null>(null);
  const [alt, setAlt] = useState(false);
  const altRef = useRef(false);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { altRef.current = e.altKey; setAlt(e.altKey); };
    const g = (e: PointerEvent) => { altRef.current = e.altKey; };
    window.addEventListener("keydown", f);
    window.addEventListener("keyup", f);
    window.addEventListener("pointermove", g);
    return () => {
      window.removeEventListener("keydown", f);
      window.removeEventListener("keyup", f);
      window.removeEventListener("pointermove", g);
    };
  }, []);

  const onDragStart = (e: DragStartEvent) => setActive(e.active.data.current as DragData);
  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.data.current as { memberId: string; month: MonthKey } | undefined;
    setActive(null);
    if (!data || !target) return;
    if (data.type === "palette") {
      assign({ month: target.month, memberId: target.memberId, projectId: data.projectId });
      return;
    }
    const a = data.assignment;
    if (a.memberId === target.memberId && a.month === target.month) return;
    const dup = (cells.get(cellKey(target.memberId, target.month)) ?? []).find((x) => x.projectId === a.projectId);
    if (altRef.current) {
      assign({ month: target.month, memberId: target.memberId, projectId: a.projectId, statusId: a.statusId, ratio: a.ratio });
    } else if (dup) {
      assign({ month: target.month, memberId: target.memberId, projectId: a.projectId, statusId: a.statusId, ratio: a.ratio });
      removeAssignment(a.id);
    } else {
      updateAssignment(a.id, { month: target.month, memberId: target.memberId });
    }
  };

  /* ポップオーバー / ピッカー */
  const [pop, setPop] = useState<{ id: string; anchor: Anchor } | null>(null);
  const [picker, setPicker] = useState<{ memberId: string; month: MonthKey; anchor: Anchor } | null>(null);
  const onOpen = useCallback((a: Assignment, el: Element) => {
    setPicker(null);
    setPop({ id: a.id, anchor: rectOf(el) });
  }, []);
  const onAdd = useCallback((memberId: string, month: MonthKey, el: Element) => {
    setPop(null);
    setPicker({ memberId, month, anchor: rectOf(el) });
  }, []);
  const popAssignment = pop ? db.assignments.find((a) => a.id === pop.id) : undefined;

  /* 右端ハンドルによる期間塗り */
  const [fill, setFill] = useState<{ memberId: string; from: number; to: number } | null>(null);
  const fillRef = useRef(fill);
  fillRef.current = fill;
  const monthsRef = useRef(months);
  monthsRef.current = months;
  const onFillStart = useCallback(
    (e: React.PointerEvent, a: Assignment) => {
      e.preventDefault();
      setPop(null);
      const from = monthsRef.current.indexOf(a.month);
      if (from < 0) return;
      const init = { memberId: a.memberId, from, to: from };
      fillRef.current = init;
      setFill(init);
      document.body.classList.add("sch-filling");
      const move = (ev: PointerEvent) => {
        const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-sch-cell]");
        if (!el || el.dataset.mid !== a.memberId) return;
        const i = Number(el.dataset.mi);
        setFill((f) => (f ? { ...f, to: Math.max(i, f.from) } : f));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        document.body.classList.remove("sch-filling");
        const f = fillRef.current;
        setFill(null);
        if (f && f.to > f.from) {
          assignRange({
            months: monthsRef.current.slice(f.from + 1, f.to + 1),
            memberId: a.memberId,
            projectId: a.projectId,
            statusId: a.statusId,
            ratio: a.ratio,
          });
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [assignRange],
  );

  const activeProject =
    active?.type === "palette" ? projectMap.get(active.projectId) : active?.type === "chip" ? projectMap.get(active.assignment.projectId) : undefined;

  const pickerMember = picker ? db.members.find((m) => m.id === picker.memberId) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="sch-root">
        <header className="sch-head">
          <div className="sch-title-block">
            <div className="sch-kicker sch-mono">
              <button className="sch-year-btn" onClick={() => setFiscalYear(fiscalYear - 1)} aria-label="前年度">←</button>
              {fiscalYear}年度
              <button className="sch-year-btn" onClick={() => setFiscalYear(fiscalYear + 1)} aria-label="次年度">→</button>
            </div>
            <h1 className="sch-title">
              アサイン <em>{fiscalYear}年度</em>
            </h1>
          </div>
          <dl className="sch-summary">
            <div>
              <dt>受注金額合計</dt>
              <dd className="sch-mono">{fmtYen(stats.contract)}</dd>
            </div>
            <div>
              <dt>平均稼働率</dt>
              <dd className="sch-mono">{Math.round(stats.avg * 100)}<small>%</small></dd>
            </div>
            <div>
              <dt>未アサイン時間</dt>
              <dd className="sch-mono">{Math.round(stats.free * 10) / 10}<small>h</small></dd>
            </div>
          </dl>
        </header>

        <div className="sch-body">
          <div className="sch-scroll">
            {rows.length === 0 ? (
              <div className="sch-empty">メンバーがいません。まず「組織」でメンバーを追加してください。</div>
            ) : (
              <table className="sch-table">
                <colgroup>
                  <col className="sch-col-name" />
                  {months.map((m) => <col key={m} />)}
                  <col className="sch-col-end" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="sch-th sch-th-name">メンバー</th>
                    {months.map((m) => (
                      <th key={m} className={`sch-th ${m === nowKey ? "is-now" : ""}`}>
                        <span className="sch-mono sch-th-m">{monthNum(m)}<small>月</small></span>
                        {(monthNum(m) === 1 || m === months[0]) && <span className="sch-mono sch-th-y">{m.slice(0, 4)}</span>}
                      </th>
                    ))}
                    <th className="sch-th sch-th-end">年間稼働</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ member, depth }) => {
                    const role = roleMap.get(member.roleId);
                    const y = stats.memberYear.get(member.id) ?? 0;
                    const rate = y / 12;
                    return (
                      <tr key={member.id} className={`sch-tr ${depth === 0 ? "is-root" : ""}`}>
                        <th className="sch-td-name" scope="row">
                          <div className="sch-name" style={{ paddingLeft: depth * 16 }}>
                            <span className="sch-dot" style={{ background: role?.color ?? "var(--ink-3)" }} />
                            <span className="sch-name-text">
                              <span className="sch-name-main">{member.name}</span>
                              <span className="sch-name-role">{role?.name}</span>
                            </span>
                          </div>
                        </th>
                        {months.map((m, i) => (
                          <Cell
                            key={m}
                            memberId={member.id}
                            month={m}
                            mi={i}
                            hpm={hpm}
                            list={cells.get(cellKey(member.id, m)) ?? EMPTY}
                            projectMap={projectMap}
                            statusMap={statusMap}
                            filling={!!fill && fill.memberId === member.id && i > fill.from && i <= fill.to}
                            isNow={m === nowKey}
                            onOpen={onOpen}
                            onFillStart={onFillStart}
                            onAdd={onAdd}
                          />
                        ))}
                        <td className="sch-td-end">
                          <span className={`sch-mono sch-rate ${rate > 1.0001 ? "is-over" : ""}`}>{Math.round(rate * 100)}<small>%</small></span>
                          <span className="sch-rate-bar"><i style={{ width: `${Math.min(rate, 1) * 100}%` }} /></span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="sch-foot sch-foot-1">
                    <th className="sch-foot-label">稼働時間</th>
                    {stats.monthSum.map((v, i) => (
                      <td key={i} className="sch-mono">
                        {v ? fmtHours(ratioToHours(v, hpm)) : "—"}
                      </td>
                    ))}
                    <td className="sch-mono sch-foot-end">
                      {fmtHours(ratioToHours(stats.monthSum.reduce((a, b) => a + b, 0), hpm))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <motion.aside className="sch-panel" animate={{ width: panelOpen ? 280 : 40 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            <button className="sch-panel-toggle" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
              <span className="sch-mono">{panelOpen ? "→" : "←"}</span>
              {!panelOpen && <span className="sch-panel-vert">案件パレット</span>}
            </button>
            {panelOpen && (
              <div className="sch-panel-in">
                <div className="sch-panel-head">
                  <h2>案件<em>パレット</em></h2>
                  <p>セルへドラッグして配置 · 案件名クリックで詳細</p>
                  <input className="sch-input" placeholder="絞り込み…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <div className="sch-pal-list">
                  {palette.length === 0 && <div className="sch-empty-s">この年度に有効な案件がありません</div>}
                  {palette.map((p) => (
                    <PaletteChip
                      key={p.id}
                      p={p}
                      months={months}
                      open={openPal === p.id}
                      onToggle={togglePal}
                      assigned={assignedHours.get(p.id)}
                      statusMap={statusMap}
                    />
                  ))}
                </div>
                <p className="sch-hint">Alt + ドラッグで複製 / チップ右端を右へドラッグで期間塗り</p>
              </div>
            )}
          </motion.aside>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {activeProject && (
          <div className="sch-overlay">
            <ChipBody
              floating
              project={activeProject}
              hours={ratioToHours(active?.type === "chip" ? active.assignment.ratio : 1, hpm)}
              status={active?.type === "chip" && active.assignment.statusId ? statusMap.get(active.assignment.statusId) : undefined}
            />
            {active?.type === "chip" && alt && <span className="sch-copy-badge">＋ 複製</span>}
          </div>
        )}
      </DragOverlay>

      <AnimatePresence>
        {pop && popAssignment && (
          <AssignmentPopover
            key={pop.id}
            anchor={pop.anchor}
            assignment={popAssignment}
            db={db}
            months={months}
            onClose={() => setPop(null)}
            update={updateAssignment}
            remove={removeAssignment}
            range={assignRange}
          />
        )}
        {picker && pickerMember && (
          <QuickPicker
            key="picker"
            anchor={picker.anchor}
            db={db}
            months={months}
            memberName={pickerMember.name}
            month={picker.month}
            onClose={() => setPicker(null)}
            onPick={(p) => {
              assign({ month: picker.month, memberId: picker.memberId, projectId: p.id });
              setPicker(null);
            }}
          />
        )}
      </AnimatePresence>
    </DndContext>
  );
}

const EMPTY: Assignment[] = [];
