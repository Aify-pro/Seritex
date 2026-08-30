"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/auth/nav";
import { motion } from "framer-motion";
import { Fragment } from "react";

// Calculée en dehors du composant (pure fonction de `items`) : évite de
// muter une variable pendant le rendu, ce que la règle react-hooks
// (immutability) refuse à raison — un composant de rendu doit rester une
// fonction pure de ses props.
function withSectionHeaders(items: NavItem[]): (NavItem & { showHeader: boolean })[] {
  let lastSection: string | undefined;
  return items.map((item) => {
    const showHeader = Boolean(item.section && item.section !== lastSection);
    lastSection = item.section;
    return { ...item, showHeader };
  });
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const itemsWithHeaders = withSectionHeaders(items);

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {itemsWithHeaders.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");

        return (
          <Fragment key={item.href}>
            {item.showHeader && (
              <div className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted/70 first:mt-1">
                {item.section}
              </div>
            )}
            <Link
              href={item.href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-brand"
                  : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
              )}
            >
              {active && (
                <motion.span
                  layoutId="active-nav-pill"
                  className="absolute inset-0 rounded-md bg-brand-soft"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {item.icon}
              <span className="relative z-10">{item.label}</span>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
