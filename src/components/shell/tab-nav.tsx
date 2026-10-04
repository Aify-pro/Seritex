"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface TabNavItem {
  href: string;
  label: string;
  /** Onglet actif quand l'URL commence par ce préfixe (par défaut : href). */
  matchPrefix?: string;
}

/**
 * Barre d'onglets générique (fiche article, livraisons…) : des liens, l'onglet
 * actif déduit de l'URL. Même rendu que les onglets de Paramètres.
 */
export function TabNav({ items, label }: { items: TabNavItem[]; label: string }) {
  const pathname = usePathname();
  const isActive = (item: TabNavItem) => {
    const prefix = item.matchPrefix ?? item.href;
    return pathname === prefix || pathname.startsWith(prefix + "/");
  };

  return (
    <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
      {items.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-brand text-brand"
                : "border-transparent text-foreground-muted hover:border-border hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
