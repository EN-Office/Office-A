import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import type { ID } from "@shared/types";
import { useStore } from "@/lib/store";
import { exportUrl } from "@/lib/api";
import { Button, ColorSwatch, ConfirmPopover, Icon, IconButton, InlineEdit, PALETTE, Select, TextInput } from "@/components/ui";
import "./SettingsView.css";

const ease = [0.2, 0.8, 0.2, 1] as const;

function Section({ no, title, en, desc, children }: { no: string; title: string; en: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="st-section">
      <div className="st-section__aside">
        <span className="num st-section__no">{no}</span>
        <h2 className="st-section__title">{title}</h2>
        <div className="st-section__en">{en}</div>
        {desc && <p className="st-section__desc">{desc}</p>}
      </div>
      <div className="st-section__body">{children}</div>
    </section>
  );
}

export default function SettingsView() {
  const settings = useStore((s) => s.db.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1 className="h1">設定<em>, quietly.</em></h1>
          <div className="page-head__meta">
            <span>会社・年度・役職・役割・出力・バックアップ</span>
          </div>
        </div>
      </header>

      <Section no="01" title="会社" en="Company" desc="年度の区切りは全画面・Excel 出力に反映されます。">
        <div className="st-grid2">
          <label className="st-field">
            <span className="eyebrow">会社名</span>
            <TextInput value={settings.companyName} onChange={(companyName) => updateSettings({ companyName })} aria-label="会社名" />
          </label>
          <div className="st-field">
            <span className="eyebrow">年度開始月</span>
            <div className="st-months" role="radiogroup" aria-label="年度開始月">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={settings.fiscalYearStartMonth === m}
                  className={`st-month num ${settings.fiscalYearStartMonth === m ? "is-on" : ""}`}
                  onClick={() => updateSettings({ fiscalYearStartMonth: m })}
                >
                  {settings.fiscalYearStartMonth === m && <motion.span layoutId="st-month-pill" className="st-month__pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                  <span>{m}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section no="02" title="役職階層" en="Hierarchy" desc="上にあるほど上位の役職です。ドラッグで並べ替え、名前と色はクリックで編集。">
        <RolesEditor />
      </Section>

      <Section no="03" title="案件内役割" en="Project roles" desc="案件ごとに必要な役割（PM / PL / 開発メンバー …）。アサイン時のステータスとしても使われます。">
        <StatusesEditor />
      </Section>

      <Section no="04" title="Excel出力" en="Export" desc="メンバー・案件・年度アサイン・売上サマリの 4 シートを生成します。">
        <ExportPanel />
      </Section>

      <Section no="05" title="データ" en="Data" desc={<>すべてのデータはローカルの <code className="num st-code">data/db.json</code> に保存されます。</>}>
        <DataPanel />
      </Section>
    </div>
  );
}

/* ================= sortable row ================= */

function SortRow({ id, children }: { id: ID; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`st-row ${isDragging ? "is-dragging-row" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <span className="st-row__grip grab" {...attributes} {...listeners} aria-label="ドラッグで並べ替え">
        <Icon name="grip" size={14} />
      </span>
      {children}
    </div>
  );
}

function useListSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
}

/* ================= roles ================= */

function RolesEditor() {
  const roles = useStore((s) => s.db.roles);
  const members = useStore((s) => s.db.members);
  const { addRole, updateRole, removeRole, mutate } = useStore.getState();
  const sorted = useMemo(() => [...roles].sort((a, b) => a.level - b.level), [roles]);
  const counts = useMemo(() => {
    const m = new Map<ID, number>();
    for (const x of members) m.set(x.roleId, (m.get(x.roleId) ?? 0) + 1);
    return m;
  }, [members]);
  const sensors = useListSensors();
  const [fresh, setFresh] = useState<ID | null>(null);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    document.body.classList.remove("is-dragging");
    if (!over || active.id === over.id) return;
    const ids = sorted.map((r) => r.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    mutate((db) => {
      for (const r of db.roles) r.level = next.indexOf(r.id);
      db.roles.sort((a, b) => a.level - b.level);
    });
  };

  const add = () => {
    const level = sorted.length ? sorted[sorted.length - 1].level + 1 : 0;
    const r = addRole({ name: "新しい役職", level, color: PALETTE[(sorted.length + 6) % PALETTE.length] });
    setFresh(r.id);
  };

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => document.body.classList.add("is-dragging")} onDragEnd={onDragEnd} onDragCancel={() => document.body.classList.remove("is-dragging")}>
        <SortableContext items={sorted.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="st-list">
            <AnimatePresence initial={false}>
              {sorted.map((r, i) => (
                <motion.li key={r.id} className="st-li" layout="position" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2, ease }}>
                  <SortRow id={r.id}>
                    <span className="num st-row__lv">L{i}</span>
                    <ColorSwatch value={r.color} onChange={(color) => updateRole(r.id, { color })} label={`${r.name} の色`} />
                    <span className="st-row__name">
                      <InlineEdit value={r.name} label="役職名" autoEdit={fresh === r.id} onCommit={(name) => { updateRole(r.id, { name }); setFresh(null); }} />
                    </span>
                    <span className="st-row__meta num">{counts.get(r.id) ?? 0}<span className="muted"> 名</span></span>
                    <span className="st-row__actions">
                      <ConfirmPopover
                        message={<><b>{r.name}</b> を削除しますか？{(counts.get(r.id) ?? 0) > 0 && <><br /><span className="muted small">該当メンバーは最下位の役職へ移ります。</span></>}</>}
                        onConfirm={() => removeRole(r.id)}
                      >
                        {(open) => <IconButton icon="trash" label="削除" size="sm" variant="danger" disabled={sorted.length <= 1} onClick={open} />}
                      </ConfirmPopover>
                    </span>
                  </SortRow>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </DndContext>
      <Button variant="ghost" icon="plus" size="sm" className="st-add" onClick={add}>役職を追加</Button>
    </div>
  );
}

/* ================= role statuses ================= */

function StatusesEditor() {
  const statuses = useStore((s) => s.db.roleStatuses);
  const projects = useStore((s) => s.db.projects);
  const assignments = useStore((s) => s.db.assignments);
  const { addRoleStatus, updateRoleStatus, removeRoleStatus, mutate } = useStore.getState();
  const sorted = useMemo(() => [...statuses].sort((a, b) => a.order - b.order), [statuses]);
  const usage = useMemo(() => {
    const m = new Map<ID, { projects: number; assignments: number }>();
    for (const s of statuses) m.set(s.id, { projects: 0, assignments: 0 });
    for (const p of projects) for (const r of p.required) { const u = m.get(r.statusId); if (u) u.projects++; }
    for (const a of assignments) if (a.statusId) { const u = m.get(a.statusId); if (u) u.assignments++; }
    return m;
  }, [statuses, projects, assignments]);
  const sensors = useListSensors();
  const [fresh, setFresh] = useState<ID | null>(null);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    document.body.classList.remove("is-dragging");
    if (!over || active.id === over.id) return;
    const ids = sorted.map((r) => r.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    mutate((db) => {
      for (const s of db.roleStatuses) s.order = next.indexOf(s.id);
      db.roleStatuses.sort((a, b) => a.order - b.order);
    });
  };

  const add = () => {
    const s = addRoleStatus({ name: "新しい役割", color: PALETTE[(sorted.length * 5 + 3) % PALETTE.length] });
    setFresh(s.id);
  };

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => document.body.classList.add("is-dragging")} onDragEnd={onDragEnd} onDragCancel={() => document.body.classList.remove("is-dragging")}>
        <SortableContext items={sorted.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="st-list">
            <AnimatePresence initial={false}>
              {sorted.map((s) => {
                const u = usage.get(s.id) ?? { projects: 0, assignments: 0 };
                return (
                  <motion.li key={s.id} className="st-li" layout="position" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2, ease }}>
                    <SortRow id={s.id}>
                      <ColorSwatch value={s.color} onChange={(color) => updateRoleStatus(s.id, { color })} label={`${s.name} の色`} />
                      <span className="st-row__name">
                        <InlineEdit value={s.name} label="役割名" autoEdit={fresh === s.id} onCommit={(name) => { updateRoleStatus(s.id, { name }); setFresh(null); }} />
                      </span>
                      <span className="st-row__meta num">
                        {u.projects}<span className="muted"> 案件</span>
                        <span className="st-row__sep" />
                        {u.assignments}<span className="muted"> アサイン</span>
                      </span>
                      <span className="st-row__actions">
                        <ConfirmPopover
                          message={<><b>{s.name}</b> を削除しますか？{(u.projects > 0 || u.assignments > 0) && <><br /><span className="muted small">案件の必要役割とアサインのステータスから外れます。</span></>}</>}
                          onConfirm={() => removeRoleStatus(s.id)}
                        >
                          {(open) => <IconButton icon="trash" label="削除" size="sm" variant="danger" onClick={open} />}
                        </ConfirmPopover>
                      </span>
                    </SortRow>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </DndContext>
      <Button variant="ghost" icon="plus" size="sm" className="st-add" onClick={add}>役割を追加</Button>
    </div>
  );
}

/* ================= export ================= */

function ExportPanel() {
  const fy = useStore((s) => s.fiscalYear);
  const start = useStore((s) => s.db.settings.fiscalYearStartMonth);
  const [year, setYear] = useState(fy);
  const years = Array.from({ length: 7 }, (_, i) => fy - 3 + i);
  const endMonth = ((start + 10) % 12) + 1;
  const endYear = start === 1 ? year : year + 1;
  return (
    <div className="st-export">
      <div className="st-export__year">
        <Select
          value={String(year)}
          onChange={(v) => setYear(Number(v))}
          options={years.map((y) => ({ value: String(y), label: `${y}年度` }))}
          aria-label="出力する年度"
        />
        <span className="num muted small">{year}.{String(start).padStart(2, "0")} — {endYear}.{String(endMonth).padStart(2, "0")}</span>
      </div>
      <ol className="st-export__sheets">
        {["メンバー", "案件", `アサイン(${year})`, "売上サマリ"].map((s, i) => (
          <li key={s}><span className="num muted">{String(i + 1).padStart(2, "0")}</span>{s}</li>
        ))}
      </ol>
      <Button variant="primary" icon="download" onClick={() => window.open(exportUrl(year), "_blank", "noopener")}>
        .xlsx をダウンロード
      </Button>
    </div>
  );
}

/* ================= data ================= */

function DataPanel() {
  const load = useStore((s) => s.load);
  const db = useStore((s) => s.db);
  const counts = { m: db.members.length, p: db.projects.length, a: db.assignments.length, v: db.version };
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: unknown } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const download = () => {
    const db = useStore.getState().db;
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `office-a-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pick = async (file: File | undefined) => {
    setMsg(null);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || !Array.isArray(data.members) || !Array.isArray(data.projects)) {
        throw new Error("Office-A のバックアップ形式ではありません");
      }
      setPending({ name: file.name, data });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.data) });
      if (!r.ok) throw new Error(`POST /api/import ${r.status}`);
      await load();
      setMsg({ kind: "ok", text: `${pending.name} を読み込みました` });
      setPending(null);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-data">
      <dl className="st-stats">
        <div><dt className="eyebrow">Members</dt><dd className="num">{counts.m}</dd></div>
        <div><dt className="eyebrow">Projects</dt><dd className="num">{counts.p}</dd></div>
        <div><dt className="eyebrow">Assignments</dt><dd className="num">{counts.a}</dd></div>
        <div><dt className="eyebrow">Version</dt><dd className="num">v{counts.v}</dd></div>
      </dl>

      <div className="st-data__actions">
        <Button icon="download" onClick={download}>バックアップを保存 (.json)</Button>
        <Button icon="upload" variant="ghost" onClick={() => fileRef.current?.click()}>インポート…</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      <AnimatePresence>
        {pending && (
          <motion.div className="st-import" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease }}>
            <div className="grow">
              <div className="num">{pending.name}</div>
              <div className="muted small">現在のデータはすべて置き換えられます。</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>キャンセル</Button>
            <ConfirmPopover message="本当に置き換えますか？この操作は元に戻せません。" confirmLabel="置き換える" onConfirm={doImport}>
              {(open) => <Button variant="danger" size="sm" disabled={busy} onClick={open}>{busy ? "読み込み中…" : "インポート"}</Button>}
            </ConfirmPopover>
          </motion.div>
        )}
      </AnimatePresence>
      {msg && <p className={`st-msg st-msg--${msg.kind}`}>{msg.text}</p>}

      <p className="st-path muted small">
        <Icon name="folder" size={14} /> <span className="num">data/db.json</span> に保存されます
      </p>
    </div>
  );
}
