"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Fenêtre interne (modale) générique, montée dans un portail pour ne jamais
 * être coupée par un conteneur avec `overflow-hidden`. Sert de brique
 * commune à toute action qui doit s'ouvrir "sur place" plutôt que par une
 * navigation complète — création d'une fiche, prévisualisation, édition —
 * conformément au principe demandé pour le module Échantillonnage (et
 * réutilisable tel quel par les autres modules).
 *
 * Peut être utilisée en mode non contrôlé (avec `trigger`) ou contrôlée
 * (avec `open`/`onOpenChange`, sans `trigger`) pour être déclenchée depuis un
 * bouton d'action externe (ex. dans une ligne de tableau).
 */
export function Dialog({
  trigger,
  title,
  description,
  children,
  open: openProp,
  onOpenChange,
  size = "md",
}: {
  trigger?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: "sm" | "md" | "lg";
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const panelRef = useRef<HTMLDivElement>(null);

  function setOpen(value: boolean) {
    if (!controlled) setInternalOpen(value);
    onOpenChange?.(value);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sizeStyles = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
  } as const;

  return (
    <>
      {trigger && (
        <span onClick={() => setOpen(true)} className="contents">
          {trigger}
        </span>
      )}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-10 sm:pt-16">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 bg-foreground/40 backdrop-blur-[1px]"
                  onClick={() => setOpen(false)}
                  aria-hidden
                />
                <motion.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "relative z-10 w-full rounded-lg border border-border bg-surface shadow-xl",
                    sizeStyles[size]
                  )}
                >
                  {(title || description) && (
                    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                      <div>
                        {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
                        {description && <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>}
                      </div>
                      <button
                        onClick={() => setOpen(false)}
                        aria-label="Fermer"
                        className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {!title && !description && (
                    <button
                      onClick={() => setOpen(false)}
                      aria-label="Fermer"
                      className="absolute right-3 top-3 z-10 rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
