"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ParametresHub } from "@/lib/auth/parametres-hubs";

/**
 * Onglets du thème de Paramètres affiché (ex. Clients / Articles / Stock /
 * Devis sous « Intégration Sage »). Rien si le thème n'a qu'un seul écran
 * accessible, ou si la page n'appartient à aucun thème.
 */
export function ParametresTabs({ hubs }: { hubs: ParametresHub[] }) {
  const pathname = usePathname();
  const hub = hubs.find((h) => h.tabs.some((t) => pathname === t.href || pathname.startsWith(t.href + "/")));
  if (!hub || hub.tabs.length < 2) return null;

  return (
    <div className="mb-6">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted/70">
        Paramètres · {hub.label}
      </p>
      <nav aria-label={hub.label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {hub.tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand text-brand"
                  : "border-transparent text-foreground-muted hover:border-border hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
