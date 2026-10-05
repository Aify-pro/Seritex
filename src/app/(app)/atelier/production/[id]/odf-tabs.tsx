import Link from "next/link";
import { cn } from "@/lib/utils";

export type OdfTab = "general" | "production" | "livraison" | "stock" | "couts";

export const ODF_TAB_LABELS: Record<OdfTab, string> = {
  general: "Général",
  production: "Production",
  livraison: "Livraison",
  stock: "Stock",
  couts: "Coûts",
};

/**
 * Onglets de la fiche ODF : chaque catégorie d'information a son onglet, ce
 * qui permet d'en ouvrir la lecture rôle par rôle. L'onglet est dans l'URL
 * (?onglet=…), donc partageable.
 */
export function OdfTabs({ productionOrderId, current, tabs }: { productionOrderId: string; current: OdfTab; tabs: OdfTab[] }) {
  return (
    <nav aria-label="Sections de l'ordre de fabrication" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
      {tabs.map((t) => (
        <Link
          key={t}
          href={t === "general" ? `/atelier/production/${productionOrderId}` : `/atelier/production/${productionOrderId}?onglet=${t}`}
          aria-current={current === t ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            current === t ? "border-brand text-brand" : "border-transparent text-foreground-muted hover:border-border hover:text-foreground"
          )}
        >
          {ODF_TAB_LABELS[t]}
        </Link>
      ))}
    </nav>
  );
}
