import { useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { flattenTree, type ID, type Member, type Role } from "@shared/types";
import { selectFiscalMonths, selectMemberYearStats, useStore } from "@/lib/store";
import { Button, Chip, ConfirmPopover, Icon, IconButton, InlineEdit, Select } from "@/components/ui";
import "./OrgView.css";

const INDENT = 28;
const ROOT_ZONE = "__root__";

type Intent = "before" | "after" | "child";
interface DropTarget { overId: ID | typeof ROOT_ZONE; intent: Intent }

type Row = ReturnType<typeof flattenTree>[number];

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

export default function OrgView() {
  const db = useStore((s) => s.db);
  const fy = useStore((s) => s.fiscalYear);
  const addMember = useStore((s) => s.addMember);
  const moveMember = useStore((s) => s.moveMember);

  const rows = useMemo(() => flattenTree(db.members), [db.members]);
  const months = useMemo(() => selectFiscalMonths(db, fy), [db, fy]);
  const stats = useMemo(() => selectMemberYearStats(db, months), [db, months]);
  const roles = useMemo(() => [...db.roles].sort((a, b) => a.level - b.level), [db.roles]);
  const roleMap = useMemo(() => new Map(db.roles.map((r) => [r.id, r])), [db.roles]);

  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());
  const [justAdded, setJustAdded] = useState<ID | null>(null);
  const [activeId, setActiveId] = useState<ID | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const pointerY = useRef<number | null>(null);

  /* ---------- derived tree info ---------- */
  const childCount = useMemo(() => {
    const m = new Map<ID, number>();
    for (const x of db.members) if (x.parentId) m.set(x.parentId, (m.get(x.parentId) ?? 0) + 1);
    return m;
  }, [db.members]);

  const isLast = useMemo(() => {
    const lastOf = new Map<ID | null, ID>();
    for (const r of rows) lastOf.set(r.member.parentId, r.member.id);
    return (id: ID, parentId: ID | null) => lastOf.get(parentId) === id;
  }, [rows]);

  const visible = useMemo(
    () => rows.filter((r) => !r.path.slice(0, -1).some((a) => collapsed.has(a.id))),
    [rows, collapsed],
  );

  const descendantsOfActive = useMemo(() => {
    if (!activeId) return new Set<ID>();
    return new Set(rows.filter((r) => r.path.some((p) => p.id === activeId)).map((r) => r.member.id));
  }, [rows, activeId]);

  /* ---------- actions ---------- */
  const defaultChildRole = useCallback(
    (parent: Member | null): ID => {
      if (!parent) return roles[0]?.id ?? "";
      const pr = roleMap.get(parent.roleId);
      const next = roles.find((r) => pr && r.level > pr.level);
      return (next ?? roles[roles.length - 1])?.id ?? "";
    },
    [roles, roleMap],
  );

  const addRoot = () => {
    const m = addMember({ name: "新しいメンバー", roleId: defaultChildRole(null), parentId: null });
    setJustAdded(m.id);
  };
  const addChild = (parent: Member) => {
    const m = addMember({ name: "新しいメンバー", roleId: defaultChildRole(parent), parentId: parent.id });
    setCollapsed((c) => { const n = new Set(c); n.delete(parent.id); return n; });
    setJustAdded(m.id);
  };
  const toggle = (id: ID) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /* ---------- dnd ---------- */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    const ev = e.activatorEvent as PointerEvent;
    pointerY.current = ev.clientY;
    window.addEventListener("pointermove", trackPointer, { passive: true });
    document.body.classList.add("is-dragging");
  };

  const onDragMove = (e: DragMoveEvent) => {
    const { over } = e;
    if (!over || pointerY.current == null) return setTarget(null);
    const overId = String(over.id);
    if (overId === ROOT_ZONE) return setTarget({ overId: ROOT_ZONE, intent: "child" });
    // スクロールに影響されないよう、実 DOM の位置とポインタ位置から判定
    const el = document.querySelector<HTMLElement>(`[data-member-id="${CSS.escape(overId)}"]`);
    const rect = el?.getBoundingClientRect() ?? over.rect;
    const rel = (pointerY.current - rect.top) / rect.height;
    const intent: Intent = rel < 0.28 ? "before" : rel > 0.72 ? "after" : "child";
    setTarget((t) => (t?.overId === overId && t.intent === intent ? t : { overId, intent }));
  };

  const trackPointer = useCallback((ev: PointerEvent) => { pointerY.current = ev.clientY; }, []);

  const finish = () => {
    window.removeEventListener("pointermove", trackPointer);
    setActiveId(null);
    setTarget(null);
    pointerY.current = null;
    document.body.classList.remove("is-dragging");
  };

  const onDragEnd = (_e: DragEndEvent) => {
    const id = activeId;
    const t = target;
    finish();
    if (!id || !t) return;
    if (t.overId === ROOT_ZONE) {
      const roots = db.members.filter((m) => m.parentId === null && m.id !== id);
      return moveMember(id, null, roots.length);
    }
    if (t.overId === id || descendantsOfActive.has(t.overId)) return;
    const over = db.members.find((m) => m.id === t.overId);
    if (!over) return;
    if (t.intent === "child" || (t.intent === "after" && childCount.get(over.id) && !collapsed.has(over.id))) {
      // 子として追加（展開済みの子を持つ行の下端 = 先頭の子）
      const index = t.intent === "after" ? 0 : undefined;
      setCollapsed((c) => { const n = new Set(c); n.delete(over.id); return n; });
      return moveMember(id, over.id, index);
    }
    const siblings = db.members
      .filter((m) => m.parentId === over.parentId && m.id !== id)
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((m) => m.id === over.id);
    moveMember(id, over.parentId, t.intent === "before" ? idx : idx + 1);
  };

  const activeRow = activeId ? rows.find((r) => r.member.id === activeId) : undefined;

  /* ---------- header stats ---------- */
  const roleCounts = useMemo(() => {
    const m = new Map<ID, number>();
    for (const x of db.members) m.set(x.roleId, (m.get(x.roleId) ?? 0) + 1);
    return m;
  }, [db.members]);
  const avgLoad = useMemo(() => {
    if (!db.members.length) return 0;
    let s = 0;
    for (const m of db.members) s += stats.get(m.id)?.load ?? 0;
    return s / db.members.length;
  }, [db.members, stats]);

  return (
    <div className="page org">
      <header className="page-head">
        <div>
          <div className="eyebrow">{fy}年度</div>
          <h1 className="h1 org-title">組織</h1>
          <div className="page-head__meta">
            <span>人数 <b className="num">{db.members.length}</b> 名</span>
            <span>役職数 <b className="num">{db.roles.length}</b></span>
            <span>平均稼働 <b className="num">{Math.round(avgLoad * 100)}%</b></span>
          </div>
        </div>
        <div className="page-head__actions">
          <Button variant="primary" icon="plus" onClick={addRoot}>追加</Button>
        </div>
      </header>

      <div className="org-legend">
        {roles.map((r) => (
          <Chip key={r.id} color={r.color} count={roleCounts.get(r.id) ?? 0} variant="outline">{r.name}</Chip>
        ))}
        <span className="org-legend__hint muted small">
          <Icon name="grip" size={14} /> 行をドラッグ — 行の中央へで<b>部下に</b>、上下の端で<b>並び替え</b>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="display">まだ誰もいません</div>
          <p>右上の「追加」から最初のメンバーを登録しましょう。</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          autoScroll={{ threshold: { x: 0, y: 0.12 }, acceleration: 6 }}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={finish}
        >
          <div className="org-table" role="tree" aria-label="組織ツリー">
            <div className="org-cols eyebrow" aria-hidden>
              <span>メンバー</span>
              <span>役職</span>
              <span className="org-cols__r">アサイン</span>
              <span>平均稼働</span>
              <span />
            </div>
            <LayoutGroup>
              <ul className="org-list">
                <AnimatePresence initial={false}>
                  {visible.map((r) => (
                    <OrgRow
                      key={r.member.id}
                      row={r}
                      roles={roles}
                      role={roleMap.get(r.member.roleId)}
                      isLast={isLast}
                      kids={childCount.get(r.member.id) ?? 0}
                      collapsed={collapsed.has(r.member.id)}
                      onToggle={() => toggle(r.member.id)}
                      onAddChild={() => addChild(r.member)}
                      stat={stats.get(r.member.id)}
                      autoEdit={justAdded === r.member.id}
                      onEdited={() => setJustAdded(null)}
                      dragging={activeId === r.member.id}
                      disabledDrop={!!activeId && descendantsOfActive.has(r.member.id)}
                      intent={target && target.overId === r.member.id && !descendantsOfActive.has(r.member.id) ? target.intent : null}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </LayoutGroup>
            <RootZone active={!!activeId} highlighted={target?.overId === ROOT_ZONE} />
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
            {activeRow ? (
              <div className="org-ghost">
                <Icon name="grip" size={14} />
                <span className="dot" style={{ color: roleMap.get(activeRow.member.roleId)?.color }} />
                <span className="org-ghost__name">{activeRow.member.name}</span>
                <span className="muted small">{roleMap.get(activeRow.member.roleId)?.name}</span>
                {(childCount.get(activeRow.member.id) ?? 0) > 0 && (
                  <span className="num muted small">+{descendantsOfActive.size - 1}</span>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

/* ================= Row ================= */

interface OrgRowProps {
  row: Row;
  roles: Role[];
  role?: Role;
  isLast: (id: ID, parentId: ID | null) => boolean;
  kids: number;
  collapsed: boolean;
  onToggle: () => void;
  onAddChild: () => void;
  stat?: { count: number; load: number };
  autoEdit: boolean;
  onEdited: () => void;
  dragging: boolean;
  disabledDrop: boolean;
  intent: Intent | null;
}

function OrgRow({ row, roles, role, isLast, kids, collapsed, onToggle, onAddChild, stat, autoEdit, onEdited, dragging, disabledDrop, intent }: OrgRowProps) {
  const { member, depth, path } = row;
  const updateMember = useStore((s) => s.updateMember);
  const removeMember = useStore((s) => s.removeMember);

  const drag = useDraggable({ id: member.id });
  const drop = useDroppable({ id: member.id, disabled: disabledDrop });
  const setRef = useCallback((el: HTMLLIElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); }, [drag.setNodeRef, drop.setNodeRef]);

  const load = stat?.load ?? 0;
  const loadClass = load > 1.0001 ? "is-over" : load >= 0.8 ? "is-full" : load > 0 ? "is-part" : "is-none";
  const top = role ? role.level === Math.min(...roles.map((r) => r.level)) : false;

  // 罫線ガイド
  const guides = [];
  for (let k = 0; k < depth; k++) {
    const node = path[k + 1];
    const last = isLast(node.id, node.parentId);
    if (k === depth - 1) guides.push(<span key={k} className={`org-guide org-guide--elbow ${last ? "is-last" : ""}`} style={{ left: k * INDENT }} />);
    else if (!last) guides.push(<span key={k} className="org-guide org-guide--line" style={{ left: k * INDENT }} />);
  }

  return (
    <motion.li
      ref={setRef}
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: dragging ? 0.35 : disabledDrop ? 0.4 : 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      {...drag.attributes}
      {...drag.listeners}
      data-member-id={member.id}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={kids ? !collapsed : undefined}
      className={`org-row ${intent ? `is-drop-${intent}` : ""} ${disabledDrop ? "is-nodrop" : ""} ${top ? "is-top" : ""}`}
      style={{ "--depth": depth, "--role": role?.color ?? "var(--ink-3)" } as React.CSSProperties}
    >
      <div className="org-row__main">
        <div className="org-row__indent" style={{ width: depth * INDENT }}>{guides}</div>
        <span className="org-row__grip" aria-hidden><Icon name="grip" size={14} /></span>
        {kids > 0 ? (
          <button
            type="button"
            className={`org-row__caret ${collapsed ? "is-collapsed" : ""}`}
            aria-label={collapsed ? "展開" : "折りたたむ"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggle}
          >
            <Icon name="chevronDown" size={12} />
          </button>
        ) : (
          <span className="org-row__caret-spacer" />
        )}
        <span className="org-row__dot" title={role?.name} />
        <span className="org-row__name">
          <InlineEdit value={member.name} label="名前" autoEdit={autoEdit} onCommit={(name) => { updateMember(member.id, { name }); onEdited(); }} />
        </span>
        {kids > 0 && <span className="org-row__kids num">{kids}</span>}
      </div>

      <div className="org-row__role" onPointerDown={(e) => e.stopPropagation()}>
        <Select
          size="sm"
          aria-label="役職"
          value={member.roleId}
          onChange={(roleId) => updateMember(member.id, { roleId })}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
        />
      </div>

      <div className="org-row__count num">
        {stat?.count ? <>{stat.count}<span className="muted"> 件</span></> : <span className="muted">—</span>}
      </div>

      <div className={`org-row__load ${loadClass}`} title={`年間平均稼働 ${Math.round(load * 100)}%`}>
        <span className="org-load__bar"><motion.span className="org-load__fill" initial={false} animate={{ width: `${Math.min(100, load * 100)}%` }} transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }} /></span>
        <span className="num org-load__pct">{Math.round(load * 100)}%</span>
      </div>

      <div className="org-row__actions" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton icon="childAdd" label="部下を追加" size="sm" onClick={onAddChild} />
        <ConfirmPopover
          message={<><b>{member.name}</b> を削除しますか？{kids > 0 && <><br /><span className="muted small">部下は上長へ付け替えられます。</span></>}</>}
          onConfirm={() => removeMember(member.id)}
        >
          {(open) => <IconButton icon="trash" label="削除" size="sm" variant="danger" onClick={open} />}
        </ConfirmPopover>
      </div>

      {intent === "child" && <span className="org-drop-child" style={{ left: (depth + 1) * INDENT + 32 }}>部下として配置</span>}
    </motion.li>
  );
}

function RootZone({ active, highlighted }: { active: boolean; highlighted: boolean }) {
  const { setNodeRef } = useDroppable({ id: ROOT_ZONE });
  return (
    <div ref={setNodeRef} className={`org-rootzone ${active ? "is-active" : ""} ${highlighted ? "is-over" : ""}`}>
      <Icon name="arrowUpRight" size={14} />
      ここにドロップしてトップ階層へ
    </div>
  );
}
