import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import type { ID, ImportReport } from "@shared/types";
import { hoursPerMonthOf, useStore } from "@/lib/store";
import { exportUrl, importXlsx } from "@/lib/api";
import { Button, ColorSwatch, ConfirmPopover, Icon, IconButton, InlineEdit, NumberInput, PALETTE, Select, TextInput } from "@/components/ui";
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
  const hpm = useStore((s) => hoursPerMonthOf(s.db));

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h1 className="h1">設定</h1>
          <div className="page-head__meta">
            <span>会社・年度・役職・役割・出力・バックアップ</span>
          </div>
        </div>
      </header>

      <Section no="01" title="会社" en="Company" desc="年度の区切りと 1人月の時間は全画面・Excel 出力に反映されます。">
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
          <label className="st-field">
            <span className="eyebrow">1人月の時間</span>
            <NumberInput value={hpm} min={1} max={744} step={1} suffix="h" onChange={(hoursPerMonth) => updateSettings({ hoursPerMonth })} aria-label="1人月の時間" />
            <span className="st-hint">アサインの工数は時間で入力・表示します（{hpm}h = 1人月）。Excel のアサインセルも「80h」のように時間で書きます。</span>
          </label>
        </div>
      </Section>

      <Section no="02" title="役職階層" en="Hierarchy" desc="上にあるほど上位の役職です。ドラッグで並べ替え、名前と色はクリックで編集。">
        <RolesEditor />
      </Section>

      <Section no="03" title="案件内役割" en="Project roles" desc="案件ごとに必要な役割（PM / PL / 開発メンバー …）。アサイン時のステータスとしても使われます。">
        <StatusesEditor />
      </Section>

      <Section
        no="04"
        title="Excel"
        en="Export / Import"
        desc="メンバー・案件・年度アサイン・稼働サマリ・説明の 5 シートを生成します。Excel で編集したファイルはそのまま取り込めます。"
      >
        <ExportPanel />
        <ExcelImportPanel />
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
        {["メンバー", "案件", "アサイン", "稼働サマリ", "説明"].map((s, i) => (
          <li key={s}><span className="num muted">{String(i + 1).padStart(2, "0")}</span>{s}</li>
        ))}
      </ol>
      <Button variant="primary" icon="download" onClick={() => window.open(exportUrl(year), "_blank", "noopener")}>
        .xlsx をダウンロード
      </Button>
    </div>
  );
}

/* ================= excel import ================= */

function ExcelImportPanel() {
  const load = useStore((s) => s.load);
  const saveState = useStore((s) => s.saveState);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; report: ImportReport } | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const saving = saveState === "dirty" || saveState === "saving";

  const pick = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setMsg(null);
    setPending(null);
    setBusy("check");
    try {
      const { report } = await importXlsx(file, true);
      setPending({ file, report });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!pending) return;
    setBusy("apply");
    try {
      const { report } = await importXlsx(pending.file, false);
      await load();
      const n = report.warnings.length;
      setMsg({ kind: "ok", text: `${pending.file.name} を取り込みました${n ? `（警告 ${n} 件）` : ""}` });
      setPending(null);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const r = pending?.report;
  const months = r?.assignments.months ?? [];
  const range = months.length ? `${months[0]} — ${months[months.length - 1]}` : "対象月なし";

  return (
    <div className="st-ximport">
      <div className="st-ximport__head">
        <div>
          <div className="eyebrow">Excelから取り込み</div>
          <p className="muted small st-ximport__rule">
            編集ルールは Excel の<span className="st-ximport__link">『説明』シート</span>参照。ID 列はそのまま、行の追加・削除は可能です。
          </p>
        </div>
        <Button icon="upload" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          {busy === "check" ? "確認中…" : "Excelから取り込み…"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      <AnimatePresence>
        {pending && r && (
          <motion.div
            className="st-ximport__preview"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease }}
          >
            <div className="st-ximport__file">
              <span className="num">{pending.file.name}</span>
              <span className="muted small">プレビュー（まだ保存されていません）</span>
            </div>
            <table className="st-ximport__table">
              <thead>
                <tr>
                  <th />
                  <th className="eyebrow">追加</th>
                  <th className="eyebrow">更新</th>
                  <th className="eyebrow">削除</th>
                </tr>
              </thead>
              <tbody>
                {([["メンバー", r.members], ["案件", r.projects]] as const).map(([label, e]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="num" title={e.addedNames.join("\n")}>{e.added}</td>
                    <td className="num">{e.updated}</td>
                    <td className={`num${e.removed ? " is-danger" : ""}`} title={e.removedNames.join("\n")}>{e.removed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(r.members.removedNames.length > 0 || r.projects.removedNames.length > 0) && (
              <p className="small st-ximport__removed">
                削除: {[...r.members.removedNames, ...r.projects.removedNames].join("、")}（関連するアサインも削除されます）
              </p>
            )}
            <p className="small">
              アサイン <span className="num">{r.assignments.previous}</span> 件 → <span className="num">{r.assignments.count}</span> 件
              <span className="muted">（{range} の {months.length} ヶ月を置き換え）</span>
            </p>
            {(r.rolesAdded.length > 0 || r.statusesAdded.length > 0) && (
              <p className="small muted">
                新規作成: {[...r.rolesAdded.map((n) => `役職「${n}」`), ...r.statusesAdded.map((n) => `役割「${n}」`)].join("、")}
              </p>
            )}
            {r.warnings.length > 0 && (
              <div className="st-ximport__warn">
                <div className="small">警告 {r.warnings.length} 件</div>
                <ul>
                  {r.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="st-ximport__actions">
              {saving && <span className="muted small grow">編集内容を保存中です…</span>}
              <Button variant="ghost" size="sm" disabled={busy === "apply"} onClick={() => setPending(null)}>キャンセル</Button>
              <Button variant="primary" size="sm" icon="check" disabled={busy !== null || saving} onClick={apply}>
                {busy === "apply" ? "取り込み中…" : "取り込む"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {msg && <p className={`st-msg st-msg--${msg.kind}`}>{msg.text}</p>}
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
