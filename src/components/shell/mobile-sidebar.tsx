"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Shirt, X } from "lucide-react";
import type { NavItem } from "@/lib/auth/nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";

/**
 * Menu latéral pour mobile/tablette : sous le point de rupture `md`, le menu
 * fixe de `AppLayout` reste masqué (`hidden md:flex`), et jusqu'ici rien ne
 * le remplaçait — depuis un téléphone, la navigation était donc
 * inaccessible. Ce composant ajoute le bouton d'ouverture (hamburger) dans
 * l'en-tête mobile et le tiroir de navigation lui-même, réutilisant
 * `SidebarNav` pour rester identique au menu desktop.
 */
export function MobileSidebar({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
        className="flex h-9 w-9 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-muted hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <div className="fixed inset-0 z-50 md:hidden">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 bg-foreground/40"
                  onClick={() => setOpen(false)}
                  aria-hidden
                />
                <motion.aside
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", stiffness: 380, damping: 38 }}
                  className="relative z-10 flex h-full w-72 max-w-[80vw] flex-col border-r border-border bg-surface py-4 shadow-xl"
                >
                  <div className="mb-6 flex items-center justify-between px-4">
                    <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                      <Shirt className="h-5 w-5 text-brand" />
                      Seritex
                    </div>
                    <button
                      onClick={() => setOpen(false)}
                      aria-label="Fermer le menu"
                      className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div onClick={() => setOpen(false)} className="flex-1 overflow-y-auto">
                    <SidebarNav items={items} />
                  </div>
                </motion.aside>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
