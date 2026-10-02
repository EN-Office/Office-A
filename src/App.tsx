import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/lib/store";
import Shell from "@/components/Shell";
import DashboardView from "@/views/DashboardView";
import ScheduleView from "@/views/ScheduleView";
import OrgView from "@/views/OrgView";
import ProjectsView from "@/views/ProjectsView";
import SettingsView from "@/views/SettingsView";
import { Button } from "@/components/ui";
import "./App.css";

function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="app-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Loading({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="app-loading">
      <motion.div
        className="app-loading__inner"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="eyebrow">Resource Planner</div>
        <h1 className="app-loading__mark">PJ管理</h1>
        {error ? (
          <>
            <p className="app-loading__msg">データを読み込めませんでした。<br /><span className="num muted small">{error}</span></p>
            <Button variant="primary" onClick={onRetry}>再試行</Button>
          </>
        ) : (
          <>
            <div className="app-loading__bar"><span /></div>
            <p className="app-loading__msg muted">データを読み込んでいます</p>
          </>
        )}
      </motion.div>
    </div>
  );
}

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const load = useStore((s) => s.load);
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  const doLoad = useCallback(() => {
    setError(null);
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  useEffect(() => { doLoad(); }, [doLoad]);

  if (!loaded) return <Loading error={error} onRetry={doLoad} />;

  return (
    <Shell>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Page><DashboardView /></Page>} />
          <Route path="/schedule" element={<Page><ScheduleView /></Page>} />
          <Route path="/org" element={<Page><OrgView /></Page>} />
          <Route path="/projects" element={<Page><ProjectsView /></Page>} />
          <Route path="/settings" element={<Page><SettingsView /></Page>} />
          <Route path="*" element={<Page><div className="page"><h1 className="h1">ページが見つかりません</h1></div></Page>} />
        </Routes>
      </AnimatePresence>
    </Shell>
  );
}
