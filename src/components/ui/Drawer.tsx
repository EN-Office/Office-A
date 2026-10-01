import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { IconButton } from "./Button";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}

/** 右側ドロワー。Esc / 背景クリックで閉じる */
export function Drawer({ open, onClose, title, eyebrow, footer, width = 520, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="ui-drawer-root">
          <motion.div
            className="ui-drawer__backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.aside
            className="ui-drawer"
            role="dialog"
            aria-modal="true"
            style={{ width }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
          >
            <header className="ui-drawer__head">
              <div className="grow">
                {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                {title && <h2 className="ui-drawer__title">{title}</h2>}
              </div>
              <IconButton icon="close" label="閉じる" onClick={onClose} />
            </header>
            <div className="ui-drawer__body">{children}</div>
            {footer && <footer className="ui-drawer__foot">{footer}</footer>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
