import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/lib/store";
import { exportUrl } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Icon, IconButton, type IconName } from "@/components/ui";
import "./Shell.css";

const NAV: Array<{ to: string; label: string; en: string; icon: IconName }> = [
  { to: "/", label: "ダッシュボード", en: "Overview", icon: "dashboard" },
  { to: "/schedule", label: "アサイン", en: "Schedule", icon: "grid" },
  { to: "/org", label: "組織", en: "Organization", icon: "tree" },
  { to: "/projects", label: "案件", en: "Projects", icon: "folder" },
  { to: "/settings", label: "設定", en: "Settings", icon: "settings" },
];

const SAVE_LABEL: Record<string, string> = {
  idle: "同期済み",
  dirty: "未保存の変更",
  saving: "保存中…",
  saved: "保存しました",
  error: "保存エラー",
};

function SaveIndicator() {
  const state = useStore((s) => s.saveState);
  return (
    <div className={`shell-save shell-save--${state}`} role="status" aria-live="polite">
      <span className="shell-save__dot" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          className="shell-save__label"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {SAVE_LABEL[state]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function YearStepper() {
  const fy = useStore((s) => s.fiscalYear);
  const setFy = useStore((s) => s.setFiscalYear);
  const start = useStore((s) => s.db.settings.fiscalYearStartMonth);
  const endMonth = ((start + 10) % 12) + 1;
  const endYear = start === 1 ? fy : fy + 1;
  return (
    <div className="shell-year">
      <div className="eyebrow">Fiscal year</div>
      <div className="shell-year__row">
        <IconButton icon="chevronLeft" label="前年度" size="sm" onClick={() => setFy(fy - 1)} />
        <div className="shell-year__val">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={fy}
              className="num shell-year__num"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {fy}
            </motion.span>
          </AnimatePresence>
          <span className="shell-year__unit">年度</span>
        </div>
        <IconButton icon="chevronRight" label="次年度" size="sm" onClick={() => setFy(fy + 1)} />
      </div>
      <div className="num shell-year__range">
        {fy}.{String(start).padStart(2, "0")} — {endYear}.{String(endMonth).padStart(2, "0")}
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const [theme, toggleTheme] = useTheme();
  const fy = useStore((s) => s.fiscalYear);
  const company = useStore((s) => s.db.settings.companyName);
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [pathname]);

  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="shell-brand">
          <div className="shell-brand__mark">PJ管理</div>
          <div className="shell-brand__sub">{company && company !== "Office-A" ? company : "開発本部BS部"}</div>
        </div>

        <nav className="shell-nav" aria-label="メインナビゲーション">
          {NAV.map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `shell-nav__item ${isActive ? "is-active" : ""}`}>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="shell-nav-indicator" className="shell-nav__indicator" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                  )}
                  <span className="num shell-nav__idx">{String(i + 1).padStart(2, "0")}</span>
                  <span className="shell-nav__label">{n.label}</span>
                  <span className="shell-nav__en">{n.en}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <YearStepper />

        <div className="shell-foot">
          <button type="button" className="shell-export" onClick={() => window.open(exportUrl(fy), "_blank", "noopener")}>
            <span>
              <span className="shell-export__label">Excel出力</span>
              <span className="num shell-export__sub">{fy}年度 .xlsx</span>
            </span>
            <Icon name="arrowUpRight" size={16} />
          </button>
          <div className="shell-foot__row">
            <SaveIndicator />
            <IconButton
              icon={theme === "dark" ? "sun" : "moon"}
              label={theme === "dark" ? "ライトモード" : "ダークモード"}
              size="sm"
              variant="outline"
              onClick={toggleTheme}
            />
          </div>
        </div>
      </aside>
      <main ref={mainRef} className="shell-main">{children}</main>
    </div>
  );
}
