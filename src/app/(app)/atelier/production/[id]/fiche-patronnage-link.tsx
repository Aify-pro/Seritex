"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, Lock, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { searchFichesForOdf, linkOdf } from "@/app/(app)/atelier/patronnage/fiches-actions";
import type { StatutFiche } from "@/lib/patronnage/types";

const STATUT_LABELS: Record<StatutFiche, string> = {
  demande: "Demande",
  traces_deposes: "Tracés déposés",
  bon_pour_coupe: "Bon pour coupe",
  archive: "Archivé",
};

const STATUT_TONE: Record<StatutFiche, "info" | "brand" | "success" | "neutral"> = {
  demande: "info",
  traces_deposes: "brand",
  bon_pour_coupe: "success",
  archive: "neutral",
};

interface FicheOption {
  id: string;
  numero_ot: string;
  statut: StatutFiche;
  client_libelle: string | null;
}

/**
 * Carte "Fiche Patronnage liée" sur la fiche ODF — pendant de la carte
 * "Ordre de fabrication lié" côté Patronnage : le lien est accessible des
 * deux côtés (section 10 du document de logique). N'apparaît que si la
 * section Coupe est retenue ou qu'une fiche est déjà liée (sinon aucune
 * pertinence à l'afficher).
 *
 * editable=false une fois l'ODF hors brouillon : à partir de
 * en_attente_validation, le lien ne change plus depuis cet écran — soit il a
 * déjà été validé par validate_production_order() (Coupe retenue), soit il
 * n'y a plus lieu d'y toucher. La RLS (lot 2) verrouille de toute façon la
 * fiche elle-même dès que l'ODF atteint en_production.
 */
export function FichePatronnageLink({
  productionOrderId,
  editable,
  fiche,
}: {
  productionOrderId: string;
  editable: boolean;
  fiche: { id: string; numeroOt: string; statut: StatutFiche } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<FicheOption[]>([]);
  const [open, setOpen] = useState(false);

  async function handleChange(v: string) {
    setQuery(v);
    if (v.trim().length < 1) {
      setOptions([]);
      return;
    }
    const res = await searchFichesForOdf(v, productionOrderId);
    setOptions(res as FicheOption[]);
    setOpen(true);
  }

  function linkTo(newFicheId: string) {
    startTransition(async () => {
      const res: { error?: string } = await linkOdf(newFicheId, productionOrderId);
      if (res.error) toast.error(res.error);
      else toast.success("Fiche Patronnage liée");
      setQuery("");
      setOpen(false);
    });
  }

  function unlink() {
    if (!fiche) return;
    startTransition(async () => {
      const res: { error?: string } = await linkOdf(fiche.id, null);
      if (res.error) toast.error(res.error);
      else toast.success("Fiche déliée");
    });
  }

  const needsAttention = fiche && fiche.statut !== "bon_pour_coupe";

  return (
    <Card>
      <CardHeader
        title="Fiche Patronnage liée"
        description="Obligatoire pour valider l'ODF tant que la section Coupe est retenue."
      />
      <CardBody className="space-y-3">
        {fiche ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <Link
                href="/atelier/patronnage"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                title="Voir dans le module Patronnage"
              >
                {fiche.numeroOt} <ExternalLink className="h-3 w-3" />
              </Link>
              <div className="mt-1">
                <Badge tone={STATUT_TONE[fiche.statut]}>{STATUT_LABELS[fiche.statut]}</Badge>
              </div>
            </div>
            {editable && (
              <Button size="sm" variant="ghost" loading={pending} onClick={unlink}>
                Délier
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">Aucune fiche liée.</p>
        )}

        {needsAttention && (
          <p className="text-xs text-warning">
            ⚠ La validation de l&apos;ODF sera refusée tant que cette fiche n&apos;est pas au statut « Bon pour coupe ».
          </p>
        )}

        {!fiche && !editable && (
          <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <Lock className="h-3 w-3" /> Liaison possible uniquement en brouillon.
          </p>
        )}

        {editable && (
          <div className="relative">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
              <Search className="h-3.5 w-3.5 text-foreground-muted" />
              <input
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Rechercher une fiche par n° OT ou client…"
                className="w-full bg-transparent text-sm text-foreground outline-none"
              />
            </div>
            {open && options.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => linkTo(o.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
                  >
                    <span>
                      {o.numero_ot} {o.client_libelle ? `— ${o.client_libelle}` : ""}
                    </span>
                    <Badge tone={STATUT_TONE[o.statut]}>{STATUT_LABELS[o.statut]}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
