"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { RepartitionNomenclatures } from "@/components/atelier/repartition-nomenclatures";
import { creerTraceDepuisBesoins, type BesoinCoupeGroupe } from "@/app/(app)/atelier/patronnage/fiches-actions";

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;
const cleGroupe = (g: BesoinCoupeGroupe) => [g.semiFiniId, g.taille, g.textileId ?? "", g.couleurId ?? "", g.couleur ?? ""].join("|");

/** Lignes d'un groupe qu'on peut cocher : un reste à couper, pas déjà coupé en t-shirts entiers. */
const cochables = (g: BesoinCoupeGroupe) => g.lignes.filter((l) => l.reste > 0 && !l.dejaEntier);

/**
 * Tableau des besoins de coupe agrégés (étape 3c) : la PAO coche ce qu'elle
 * regroupe sur un matelas. Le tracé créé porte les pièces cochées ; les
 * quantités par couche se corrigent ensuite sur sa fiche, les couches se
 * répartissent entre les articles, et le fichier du tracé (Modaris/Diamino)
 * fait référence.
 */
export function BesoinsCoupe({
  groupes,
  erreur,
  ordres,
  peutCreer,
}: {
  groupes: BesoinCoupeGroupe[];
  erreur: string | null;
  ordres: { id: string; numeroOt: string; designation: string | null }[];
  peutCreer: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [semiFini, setSemiFini] = useState("");
  const [tissu, setTissu] = useState("");
  const [couleur, setCouleur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [resteSeulement, setResteSeulement] = useState(true);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const [choix, setChoix] = useState<Record<string, Set<string>>>({});
  const [cible, setCible] = useState("");

  const semiFinis = useMemo(() => [...new Map(groupes.map((g) => [g.semiFiniId, g.semiFiniNom])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [groupes]);
  const tissus = useMemo(() => [...new Map(groupes.filter((g) => g.textileId).map((g) => [g.textileId as string, `${g.tissu ?? "?"}${g.grammage ? ` ${g.grammage} g` : ""}`])).entries()], [groupes]);
  const couleurs = useMemo(() => [...new Map(groupes.filter((g) => g.couleurId).map((g) => [g.couleurId as string, g.couleur ?? "?"])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [groupes]);

  const visibles = groupes.filter((g) => {
    if (semiFini && g.semiFiniId !== semiFini) return false;
    if (tissu && g.textileId !== tissu) return false;
    if (couleur && g.couleurId !== couleur) return false;
    if (resteSeulement && g.reste <= 0) return false;
    const q = recherche.trim().toLowerCase();
    if (q && !g.lignes.some((l) => `${l.odf} ${l.client} ${l.article}`.toLowerCase().includes(q))) return false;
    return true;
  });

  const selection = Object.entries(choix).filter(([, s]) => s.size > 0);
  const nbLignes = new Set(selection.flatMap(([, s]) => [...s])).size;

  function basculerLigne(g: BesoinCoupeGroupe, lineId: string, coche: boolean) {
    setChoix((prev) => {
      const s = new Set(prev[cleGroupe(g)] ?? []);
      if (coche) s.add(lineId);
      else s.delete(lineId);
      return { ...prev, [cleGroupe(g)]: s };
    });
  }
  function basculerGroupe(g: BesoinCoupeGroupe, coche: boolean) {
    setChoix((prev) => ({ ...prev, [cleGroupe(g)]: new Set(coche ? cochables(g).map((l) => l.lineId) : []) }));
  }

  function creer() {
    startTransition(async () => {
      const selections = selection.flatMap(([cle, lineIds]) => {
        const g = groupes.find((x) => cleGroupe(x) === cle);
        return g ? [{ semiFiniId: g.semiFiniId, taille: g.taille, lineIds: [...lineIds] }] : [];
      });
      const res = await creerTraceDepuisBesoins({ ficheId: cible || null, selections });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      if ("ficheId" in res) {
        toast.success(`Tracé ${res.numeroOt} créé`);
        for (const a of res.avertissements ?? []) toast.warning(a);
        router.push(`/atelier/patronnage/${res.ficheId}`);
      }
    });
  }

  const champ = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

  return (
    <div className="space-y-4">
      {erreur && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{erreur}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <select value={semiFini} onChange={(e) => setSemiFini(e.target.value)} className={champ} aria-label="Semi-fini">
          <option value="">Tous les semi-finis</option>
          {semiFinis.map(([id, nom]) => (
            <option key={id} value={id}>
              {nom}
            </option>
          ))}
        </select>
        <select value={tissu} onChange={(e) => setTissu(e.target.value)} className={champ} aria-label="Tissu et grammage">
          <option value="">Tous les tissus</option>
          {tissus.map(([id, nom]) => (
            <option key={id} value={id}>
              {nom}
            </option>
          ))}
        </select>
        <select value={couleur} onChange={(e) => setCouleur(e.target.value)} className={champ} aria-label="Couleur">
          <option value="">Toutes les couleurs</option>
          {couleurs.map(([id, nom]) => (
            <option key={id} value={id}>
              {nom}
            </option>
          ))}
        </select>
        <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="ODF, client, article…" className={`${champ} min-w-52`} aria-label="Rechercher" />
        <label className="flex items-center gap-1.5 text-sm text-foreground">
          <input type="checkbox" checked={resteSeulement} onChange={(e) => setResteSeulement(e.target.checked)} /> Reste à couper seulement
        </label>
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>{""}</Th>
                <Th>Pièce (semi-fini)</Th>
                <Th>Taille</Th>
                <Th>Tissu</Th>
                <Th>Couleur</Th>
                <Th align="right">Demandées</Th>
                <Th align="right">Coupées</Th>
                <Th align="right">Prévues</Th>
                <Th align="right">Reste</Th>
                <Th align="right">Articles</Th>
              </Tr>
            </Thead>
            <Tbody>
              {visibles.map((g) => {
                const cle = cleGroupe(g);
                const ouvert = ouverts.has(cle);
                const coches = choix[cle] ?? new Set<string>();
                const nbCochables = cochables(g).length;
                return (
                  <Fragment key={cle}>
                    <Tr>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          {peutCreer && (
                            <input
                              type="checkbox"
                              aria-label={`Cocher ${g.semiFiniNom} ${libelleTaille(g.taille)}`}
                              disabled={nbCochables === 0}
                              checked={nbCochables > 0 && coches.size === nbCochables}
                              onChange={(e) => basculerGroupe(g, e.target.checked)}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setOuverts((prev) => {
                                const n = new Set(prev);
                                if (n.has(cle)) n.delete(cle);
                                else n.add(cle);
                                return n;
                              })
                            }
                            className="text-foreground-muted hover:text-foreground"
                            aria-label={ouvert ? "Replier" : "Déplier"}
                          >
                            {ouvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        </span>
                      </Td>
                      <Td className="font-medium">
                        {g.semiFiniCode ? `${g.semiFiniCode} · ` : ""}
                        {g.semiFiniNom}
                      </Td>
                      <Td>{libelleTaille(g.taille)}</Td>
                      <Td>
                        {g.tissu ? `${g.tissu}${g.grammage ? ` ${g.grammage} g` : ""}` : <span className="text-foreground-muted">—</span>}
                        {g.formes.includes("tubulaire") && <Badge tone="info" className="ml-1.5">{g.formes.length > 1 ? "tubulaire + ouvert" : "tubulaire"}</Badge>}
                      </Td>
                      <Td>{g.couleur ?? <span className="text-foreground-muted">—</span>}</Td>
                      <Td align="right">{g.demandees}</Td>
                      <Td align="right">{g.coupees}</Td>
                      <Td align="right">{g.prevues}</Td>
                      <Td align="right">
                        <Badge tone={g.reste > 0 ? "warning" : g.reste === 0 ? "success" : "danger"}>{g.reste}</Badge>
                      </Td>
                      <Td align="right">
                        {g.nbLignes} · {g.nbOdf} ODF
                      </Td>
                    </Tr>
                    {ouvert &&
                      g.lignes.map((l) => (
                        <Tr key={l.lineId} className="bg-surface-muted/40">
                          <Td>
                            {peutCreer && (
                              <input
                                type="checkbox"
                                aria-label={`Cocher ${l.odf}`}
                                disabled={l.reste <= 0 || l.dejaEntier}
                                checked={coches.has(l.lineId)}
                                onChange={(e) => basculerLigne(g, l.lineId, e.target.checked)}
                              />
                            )}
                          </Td>
                          <td colSpan={4} className="px-4 py-3 align-middle text-xs text-foreground">
                            <span className="font-medium">{l.odf}</span> · {l.client} · {l.article}
                            {l.dejaEntier && <span className="ml-2 text-warning">déjà coupé ou validé en t-shirts entiers : ne peut pas être regroupé</span>}
                            {l.parPieces && <span className="ml-2 text-foreground-muted">déjà coupé par pièces</span>}
                            {l.formes.includes("tubulaire") && <span className="ml-2 font-medium">{l.formes.join(" + ")}</span>}
                            {peutCreer && l.repartissable && <span className="ml-1 inline-block"><RepartitionNomenclatures lineId={l.lineId} article={`${l.odf} · ${l.article}`} /></span>}
                          </td>
                          <Td align="right" className="text-xs">{l.demandees}</Td>
                          <Td align="right" className="text-xs">{l.coupees}</Td>
                          <Td align="right" className="text-xs">{l.prevues}</Td>
                          <Td align="right" className="text-xs">{l.reste}</Td>
                          <Td>{""}</Td>
                        </Tr>
                      ))}
                  </Fragment>
                );
              })}
              {visibles.length === 0 && <EmptyRow colSpan={10}>Aucun besoin de coupe pour ces critères.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      {peutCreer && selection.length > 0 && (
        <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/40 bg-surface p-3 shadow-lg">
          <p className="text-sm text-foreground">
            <span className="font-medium">{selection.length}</span> pièce{selection.length > 1 ? "s" : ""} (semi-fini × taille) pour{" "}
            <span className="font-medium">{nbLignes}</span> article{nbLignes > 1 ? "s" : ""} d&apos;ODF
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={cible} onChange={(e) => setCible(e.target.value)} className={champ} aria-label="Ordre de coupe">
              <option value="">Nouvel ordre de coupe</option>
              {ordres.map((o) => (
                <option key={o.id} value={o.id}>
                  Ajouter à {o.numeroOt}
                  {o.designation ? ` — ${o.designation}` : ""}
                </option>
              ))}
            </select>
            <Button loading={pending} onClick={creer}>
              <Layers className="h-3.5 w-3.5" /> Créer le tracé
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
