"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem, SidebarEntry } from "@/lib/auth/nav";
import { motion } from "framer-motion";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

function isActive(pathname: string, item: NavItem) {
  const prefixes = [item.href, ...(item.matchPrefixes ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

function NavLink({ item, pathname, nested = false }: { item: NavItem; pathname: string; nested?: boolean }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "text-brand" : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
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
      <span className={cn("relative z-10", nested && "truncate")}>{item.label}</span>
    </Link>
  );
}

export function SidebarNav({ items }: { items: SidebarEntry[] }) {
  const pathname = usePathname();
  // Choix explicite de l'utilisateur (ouvrir/replier) par volet ; tant qu'il
  // n'a rien choisi, le volet est ouvert s'il contient la page affichée.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map((entry) => {
        if (!("children" in entry)) return <NavLink key={entry.href} item={entry} pathname={pathname} />;

        const containsActive = entry.children.some((child) => isActive(pathname, child));
        const open = toggled[entry.label] ?? containsActive;
        return (
          <div key={entry.label} className="mt-3 border-t border-border pt-3">
            <button
              type="button"
              aria-expanded={open}
              // Le tiroir mobile se referme au moindre clic : ouvrir un volet
              // ne doit pas le fermer.
              onClick={(e) => {
                e.stopPropagation();
                setToggled((prev) => ({ ...prev, [entry.label]: !open }));
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-muted hover:text-foreground",
                containsActive ? "text-foreground" : "text-foreground-muted"
              )}
            >
              {entry.icon}
              <span className="relative z-10 flex-1 text-left">{entry.label}</span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                {entry.children.map((child) => (
                  <NavLink key={child.href} item={child} pathname={pathname} nested />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
