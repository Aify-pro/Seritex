"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { FichePlacement } from "@/lib/patronnage/types";
import { definirModeleOrdre } from "@/app/(app)/atelier/patronnage/fiches-actions";

type Nomenclature = NonNullable<FichePlacement["nomenclaturesBilan"]>[number];
type Pieces = Map<string, Map<string, number>>; // semi-fini → taille → pièces

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;
const ajouter = (m: Pieces, sf: string, taille: string, n: number) => {
  if (n <= 0) return;
  const parTaille = m.get(sf) ?? new Map<string, number>();
  parTaille.set(taille, (parTaille.get(taille) ?? 0) + n);
  m.set(sf, parTaille);
};

/** Nomenclature la plus proche des pièces de l'ordre : le plus de semi-finis en commun, puis active, puis principale. */
function meilleure(options: Nomenclature[], pieces: Pieces, lineId?: string): Nomenclature | null {
  const score = (n: Nomenclature) =>
    Object.keys(n.quantites).filter((sf) => pieces.has(sf)).length * 100 + (lineId && n.activePour.includes(lineId) ? 10 : 0) + (n.principale ? 1 : 0);
  return [...options].sort((a, b) => score(b) - score(a))[0] ?? null;
}

interface LigneTaille {
  taille: string;
  complets: number;
  demandes: number | null;
  pieces: { sf: string; nom: string; dispo: number; parVetement: number; ecart: number }[];
  /** Sans ODF : pièces à ajouter pour atteindre le t-shirt suivant possible (cible = le semi-fini le plus fourni). */
  cible: number;
}

/** Bilan d'une taille : t-shirts complets que donnent les pièces, et l'écart de chaque semi-fini. */
export function bilanTaille(nom: Nomenclature, pieces: Pieces, taille: string, demandes: number | null, noms: Map<string, string>): LigneTaille {
  const sfs = Object.entries(nom.quantites).filter(([, q]) => q > 0);
  const dispo = (sf: string) => pieces.get(sf)?.get(taille) ?? 0;
  const complets = sfs.length === 0 ? 0 : Math.min(...sfs.map(([sf, q]) => Math.floor(dispo(sf) / q)));
  const cible = sfs.length === 0 ? 0 : Math.max(...sfs.map(([sf, q]) => Math.ceil(dispo(sf) / q)));
  // Avec ODF : écart à la demande ; sans ODF : écart aux t-shirts complets (en trop) et à la cible (à compléter).
  return {
    taille,
    complets,
    demandes,
    cible,
    pieces: sfs.map(([sf, q]) => ({
      sf,
      nom: noms.get(sf) ?? "?",
      dispo: dispo(sf),
      parVetement: q,
      ecart: demandes !== null ? dispo(sf) - demandes * q : dispo(sf) - complets * q,
    })),
  };
}

/**
 * Bilan de l'ordre de tracé : à partir des pièces des tracés (quantité par
 * couche × plis, ou × couches attribuées à chaque article d'ODF) et de la
 * nomenclature, le nombre de t-shirts complets par taille et, par semi-fini,
 * les pièces en trop ou manquantes.
 *   - Avec ODF : par article, comparé à la demande (vêtements par taille).
 *   - Sans ODF : sur la nomenclature du modèle de l'ordre ; en trop = au-delà
 *     des t-shirts complets, à compléter = pour aller jusqu'au semi-fini le
 *     plus fourni.
 * Tracés annulés exclus. Calcul indicatif, sur cet ordre seulement (un article
 * peut aussi être coupé par un autre ordre).
 */
export function BilanOrdreCard({
  fiche,
  productModels,
  canModify,
}: {
  fiche: FichePlacement;
  productModels: { id: string; name: string }[];
  canModify: boolean;
}) {
  const traces = fiche.traces.filter((t) => t.statut !== "annule" && t.pieces.length > 0);
  const noms = useMemo(() => new Map(fiche.traces.flatMap((t) => t.pieces.map((p) => [p.semiFiniId, p.semiFiniNom] as [string, string]))), [fiche.traces]);
  const nomenclatures = fiche.nomenclaturesBilan ?? [];
  const sansOdf = fiche.lignesRegroupees.length === 0;

  // Toutes les pièces de l'ordre (plis), et celles attribuées à chaque article (couches).
  const { total, parLigne, nonAttribuees } = useMemo(() => {
    const total: Pieces = new Map();
    const parLigne = new Map<string, Pieces>();
    const nonAttribuees: Pieces = new Map();
    for (const t of traces) {
      const plis = t.nbPlis ?? 0;
      const attribuees = t.couches.reduce((s, c) => s + c.nbCouches, 0);
      for (const p of t.pieces) {
        ajouter(total, p.semiFiniId, p.taille, p.quantiteParCouche * plis);
        ajouter(nonAttribuees, p.semiFiniId, p.taille, p.quantiteParCouche * Math.max(plis - attribuees, 0));
        for (const c of t.couches) {
          const m = parLigne.get(c.lineId) ?? new Map();
          ajouter(m, p.semiFiniId, p.taille, p.quantiteParCouche * c.nbCouches);
          parLigne.set(c.lineId, m);
        }
      }
    }
    return { total, parLigne, nonAttribuees };
  }, [traces]);

  if (traces.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Bilan : t-shirts et pièces"
        description="Calculé à partir des pièces des tracés (quantité par couche × plis, ou × couches attribuées à chaque article) et de la nomenclature. Tracés annulés exclus ; cet ordre seulement."
      />
      <CardBody className="space-y-4">
        {sansOdf ? (
          <BilanSansOdf fiche={fiche} total={total} noms={noms} nomenclatures={nomenclatures} productModels={productModels} canModify={canModify} />
        ) : (
          <>
            {fiche.lignesRegroupees.map((l) => {
              const pieces = parLigne.get(l.lineId) ?? new Map();
              const nom = meilleure(nomenclatures.filter((n) => n.modeleId === l.modeleId), pieces.size ? pieces : total, l.lineId);
              if (!nom) return null;
              const tailles = Object.keys(l.repartition).filter((t) => (l.repartition[t] ?? 0) > 0);
              const lignes = tailles.map((t) => bilanTaille(nom, pieces, t, l.repartition[t] ?? 0, noms));
              return (
                <section key={l.lineId} className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">
                    {l.odfReference ?? "—"} · {l.description}
                    <span className="ml-1.5 text-xs font-normal text-foreground-muted">nomenclature {nom.nom}</span>
                  </p>
                  {pieces.size === 0 ? (
                    <p className="text-xs text-foreground-muted">Aucune couche attribuée à cet article pour l&apos;instant.</p>
                  ) : (
                    <TableauBilan lignes={lignes} avecDemande />
                  )}
                </section>
              );
            })}
            {nonAttribuees.size > 0 && (
              <p className="rounded-md bg-warning-soft/50 px-3 py-2 text-xs text-foreground">
                Pièces de plis prévus pas encore attribués à un article :{" "}
                {[...nonAttribuees.entries()]
                  .flatMap(([sf, parTaille]) => [...parTaille.entries()].map(([t, n]) => `${n} ${noms.get(sf) ?? "?"} ${libelleTaille(t)}`))
                  .join(", ")}
                .
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function BilanSansOdf({
  fiche,
  total,
  noms,
  nomenclatures,
  productModels,
  canModify,
}: {
  fiche: FichePlacement;
  total: Pieces;
  noms: Map<string, string>;
  nomenclatures: Nomenclature[];
  productModels: { id: string; name: string }[];
  canModify: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = nomenclatures.filter((n) => n.modeleId === fiche.productModelId);
  const [choix, setChoix] = useState<string>("");
  const nom = options.find((n) => n.id === choix) ?? meilleure(options, total);

  function choisirModele(id: string) {
    startTransition(async () => {
      const res = await definirModeleOrdre(fiche.id, id || null);
      if (res.error) toast.error(res.error);
      else router.refresh();
    });
  }

  const tailles = [...new Set([...total.values()].flatMap((m) => [...m.keys()]))].sort();
  const horsNomenclature = nom ? [...total.keys()].filter((sf) => !(nom.quantites[sf] > 0)) : [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-foreground-muted">Produit fini visé</span>
        <select
          value={fiche.productModelId ?? ""}
          disabled={!canModify || pending}
          onChange={(e) => choisirModele(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          aria-label="Modèle de l'ordre"
        >
          <option value="">— Choisir le modèle —</option>
          {productModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {options.length > 1 && (
          <select value={nom?.id ?? ""} onChange={(e) => setChoix(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" aria-label="Nomenclature">
            {options.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nom} ({n.forme})
              </option>
            ))}
          </select>
        )}
      </div>
      {!fiche.productModelId ? (
        <p className="text-xs text-foreground-muted">Pas encore d&apos;ODF : choisissez le produit fini visé pour calculer les t-shirts à partir de sa nomenclature.</p>
      ) : !nom ? (
        <p className="text-xs text-warning">Ce modèle n&apos;a pas de nomenclature : renseignez-la dans Articles (onglet Technique).</p>
      ) : (
        <>
          <TableauBilan lignes={tailles.map((t) => bilanTaille(nom, total, t, null, noms))} avecDemande={false} />
          {horsNomenclature.length > 0 && (
            <p className="text-xs text-warning">
              Pièces hors de cette nomenclature : {horsNomenclature.map((sf) => noms.get(sf) ?? "?").join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TableauBilan({ lignes, avecDemande }: { lignes: LigneTaille[]; avecDemande: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-xs text-foreground-muted">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Taille</th>
            <th className="px-3 py-1.5 text-right font-medium">T-shirts complets</th>
            {avecDemande && <th className="px-3 py-1.5 text-right font-medium">Demandés</th>}
            <th className="px-3 py-1.5 text-left font-medium">Pièces (disponibles / nécessaires)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lignes.map((l) => (
            <tr key={l.taille}>
              <td className="px-3 py-1.5 font-medium">{libelleTaille(l.taille)}</td>
              <td className={`px-3 py-1.5 text-right font-semibold ${avecDemande && l.demandes !== null && l.complets < l.demandes ? "text-danger" : ""}`}>{l.complets}</td>
              {avecDemande && <td className="px-3 py-1.5 text-right">{l.demandes ?? "—"}</td>}
              <td className="px-3 py-1.5">
                <ul className="space-y-0.5">
                  {l.pieces.map((p) => {
                    const necessaires = avecDemande && l.demandes !== null ? l.demandes * p.parVetement : l.complets * p.parVetement;
                    const aCompleter = avecDemande ? Math.max(-p.ecart, 0) : Math.max(l.cible * p.parVetement - p.dispo, 0);
                    const enTrop = Math.max(p.ecart, 0);
                    return (
                      <li key={p.sf} className="flex flex-wrap gap-x-2 text-xs">
                        <span className="font-medium">{p.nom}</span>
                        <span className="text-foreground-muted">
                          {p.dispo} / {necessaires}
                          {p.parVetement !== 1 ? ` (${p.parVetement} par vêtement)` : ""}
                        </span>
                        {enTrop > 0 && <span className="text-warning">+{enTrop} en trop</span>}
                        {aCompleter > 0 && (
                          <span className="text-danger">
                            {avecDemande ? `${aCompleter} manquante(s)` : `${aCompleter} à compléter (pour ${l.cible} t-shirts)`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
