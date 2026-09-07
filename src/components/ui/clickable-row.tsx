"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Variante de `Tr` (table.tsx) qui navigue vers `href` au clic sur la ligne
 * — style "liste cliquable" du module Échantillonnage, généralisé ici pour
 * les modules qui renvoient vers une fiche détail dédiée plutôt qu'une
 * fenêtre interne. Isolé de table.tsx (rendu serveur) car la navigation au
 * clic exige un composant client.
 *
 * La cellule Actions doit stopper la propagation du clic (`onClick={(e) =>
 * e.stopPropagation()}`) pour que ses boutons/liens internes ne déclenchent
 * pas aussi la navigation de ligne.
 */
export function ClickableTr({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      className={cn("cursor-pointer transition-colors hover:bg-surface-muted/40", className)}
    >
      {children}
    </tr>
  );
}

/**
 * À placer dans la cellule Actions d'une `ClickableTr` : stoppe la
 * propagation du clic pour que ses boutons/liens internes (Voir, PDF...) ne
 * déclenchent pas aussi la navigation de ligne portée par le `<tr>` parent.
 */
export function StopRowClick({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div onClick={(e) => e.stopPropagation()} className={className}>
      {children}
    </div>
  );
}
