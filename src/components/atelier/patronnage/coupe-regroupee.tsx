"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSearch, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { FichePlacement, TracePlacement } from "@/lib/patronnage/types";
import {
  besoinsCoupe,
  ajouterLigneRegroupee,
  retirerLigneRegroupee,
  enregistrerCouches,
  enregistrerPiecesTrace,
  preRemplirPiecesTrace,
  derogerControleTrace,
  catalogueTrace,
  type BesoinCoupeGroupe,
} from "@/app/(app)/atelier/patronnage/fiches-actions";

/**
 * Ordres de coupe regroupés (étapes 3a et 3c, migrations 0149 et 0155,
 * décisions S41-S47) : un tracé porte n'importe quel ensemble de semi-finis,
 * composé par la PAO selon l'efficience ; chaque couche du matelas appartient
 * à un article d'ODF (son tissu, sa couleur, son grammage) qui doit avoir TOUS
 * les semi-finis du tracé. Le fichier du tracé fait référence : les pièces s'en
 * pré-remplissent et la base contrôle qu'elles lui correspondent.
 */

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;

/** Reste à couper par article d'ODF et par semi-fini, déduit du tableau des besoins agrégés. */
function restesParLigne(groupes: BesoinCoupeGroupe[]) {
  const lignes = new Map<
    string,
    {
      lineId: string;
      odf: string;
      client: string;
      article: string;
      couleurs: Set<string>;
      dejaEntier: boolean;
      parSemiFini: Map<string, number>;
      parPiece: Map<string, number>;
    }
  >();
  for (const g of groupes) {
    for (const l of g.lignes) {
      const e =
        lignes.get(l.lineId) ??
        { lineId: l.lineId, odf: l.odf, client: l.client, article: l.article, couleurs: new Set<string>(), dejaEntier: l.dejaEntier, parSemiFini: new Map<string, number>(), parPiece: new Map<string, number>() };
      // Couleur de la pièce (0165) : chaque pièce peut avoir la sienne.
      if (g.couleur) e.couleurs.add(g.couleur);
      e.parSemiFini.set(g.semiFiniNom, (e.parSemiFini.get(g.semiFiniNom) ?? 0) + Math.max(l.reste, 0));
      e.parPiece.set(g.semiFiniId, (e.parPiece.get(g.semiFiniId) ?? 0) + Math.max(l.reste, 0));
      lignes.set(l.lineId, e);
    }
  }
  return lignes;
}

function resteTexte(parSemiFini: Map<string, number> | undefined) {
  if (!parSemiFini) return "";
  return [...parSemiFini.entries()]
    .filter(([, n]) => n > 0)
    .map(([nom, n]) => `${nom} ${n}`)
    .join(" · ");
}

/** Articles d'un ordre regroupé : reste à couper par semi-fini, ajout et retrait. */
export function ArticlesRegroupesCard({ fiche, canModify }: { fiche: FichePlacement; canModify: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [groupes, setGroupes] = useState<BesoinCoupeGroupe[] | null>(null);
  const [ajout, setAjout] = useState("");
  const regroupees = new Set(fiche.lignesRegroupees.map((l) => l.lineId));

  useEffect(() => {
    let annule = false;
    besoinsCoupe().then((res) => {
      if (!annule && !("error" in res)) setGroupes(res);
    });
    return () => {
      annule = true;
    };
  }, [fiche.lignesRegroupees.length, fiche.traces.length]);

  const lignes = useMemo(() => restesParLigne(groupes ?? []), [groupes]);

  function run(action: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error(res.error);
      else {
        toast.success(ok);
        setAjout("");
        router.refresh();
      }
    });
  }

  const candidats = [...lignes.values()].filter((l) => !regroupees.has(l.lineId) && !l.dejaEntier && [...l.parSemiFini.values()].some((n) => n > 0));

  return (
    <Card>
      <CardHeader
        title="Produits finis de l'ordre de coupe"
        description="Rempli depuis l'ODF et la nomenclature : vêtements par taille, puis les pièces (semi-finis) qui les composent avec leur couleur. Chaque article reçoit les pièces des couches qui lui sont attribuées dans les tracés. Reste = demandé × quantité de la nomenclature − coupé − prévu (tracés validés). Un article doit avoir tous les semi-finis d'un tracé pour y recevoir des couches."
      />
      <CardBody className="space-y-3">
        {fiche.lignesRegroupees.length === 0 ? (
          <p className="rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-sm text-foreground">
            Aucun ODF rattaché pour l&apos;instant. Les tracés se déposent et se préparent déjà ; rattachez au moins un article d&apos;ODF (ci-dessous, ou
            depuis « Besoins de coupe ») pour leur attribuer des couches et les passer « Bon pour coupe ».
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {fiche.lignesRegroupees.map((l) => {
              const b = lignes.get(l.lineId);
              const tailles = Object.entries(l.repartition).filter(([, n]) => n > 0);
              return (
                <li key={l.lineId} className="space-y-2 px-3 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p>
                        <span className="font-medium">{l.odfReference ?? "—"}</span> · {l.description}
                        {l.couleur ? ` · ${l.couleur}` : ""}
                        {l.odfAnnule && <span className="ml-1.5 rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">ODF annulé</span>}
                      </p>
                      <p className="text-xs text-foreground-muted">
                        {l.quantite != null ? `${l.quantite} vêtement${l.quantite > 1 ? "s" : ""}` : "Quantité —"}
                        {tailles.length > 0 && ` : ${tailles.map(([t, n]) => `${libelleTaille(t)} ${n}`).join(" · ")}`}
                      </p>
                    </div>
                    {canModify && (
                      <button
                        disabled={pending}
                        onClick={() => run(() => retirerLigneRegroupee(fiche.id, l.lineId), "Article retiré")}
                        className="text-foreground-muted hover:text-danger disabled:opacity-40"
                        aria-label={`Retirer ${l.description}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {l.semiFinis.length === 0 ? (
                    <p className="text-xs text-danger">Aucune pièce : la nomenclature de cet article n&apos;a pas de semi-finis.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-foreground-muted">
                        <tr>
                          <th className="py-1 text-left font-medium">Pièce (semi-fini)</th>
                          <th className="py-1 text-left font-medium">Couleur</th>
                          <th className="py-1 text-right font-medium">Reste à couper</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.semiFinis.map((p) => (
                          <tr key={p.id} className="border-t border-border">
                            <td className="py-1">{p.nom}</td>
                            <td className="py-1">{p.couleur ?? <span className="text-warning">sans couleur</span>}</td>
                            <td className="py-1 text-right">{b ? (b.parPiece.get(p.id) ?? 0) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canModify && candidats.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={ajout} onChange={(e) => setAjout(e.target.value)} className="h-9 min-w-64 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="">Ajouter un article d&apos;ODF…</option>
              {candidats.map((l) => (
                <option key={l.lineId} value={l.lineId}>
                  {l.odf} · {l.article}
                  {l.couleurs.size > 0 ? ` · ${[...l.couleurs].join(", ")}` : ""} — reste {resteTexte(l.parSemiFini)}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" disabled={!ajout} loading={pending} onClick={() => run(() => ajouterLigneRegroupee(fiche.id, ajout), "Article ajouté")}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

type LignePiece = { semiFiniId: string; taille: string; quantite: string };

/**
 * Pièces d'un tracé regroupé (0155) : semi-fini, taille et quantité posée par
 * couche. Pré-remplies depuis le fichier du tracé, modifiables à la main, et
 * contrôlées par la base contre ce que le fichier contient (D2).
 */
export function PiecesTraceEditor({
  fiche,
  trace,
  editable,
  canUnlock,
  archived,
  onChanged,
}: {
  fiche: FichePlacement;
  trace: TracePlacement;
  editable: boolean;
  canUnlock: boolean;
  archived: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const signature = JSON.stringify(trace.pieces);
  const depuisTrace = (): LignePiece[] => trace.pieces.map((p) => ({ semiFiniId: p.semiFiniId, taille: p.taille, quantite: String(p.quantiteParCouche) }));
  const [lignes, setLignes] = useState<LignePiece[]>(depuisTrace);
  const [motif, setMotif] = useState("");
  // Les pièces enregistrées ont changé (rechargement, pré-remplissage) : on repart d'elles.
  const [signatureVue, setSignatureVue] = useState(signature);
  if (signatureVue !== signature) {
    setSignatureVue(signature);
    setLignes(depuisTrace());
  }

  // Ordre de tracé sans article d'ODF : toutes les pièces et toutes les
  // tailles sont proposées (aucune nomenclature ne les apporte encore).
  const sansOdf = fiche.lignesRegroupees.length === 0;
  const [catalogue, setCatalogue] = useState<{ semiFinis: { id: string; nom: string }[]; tailles: string[] } | null>(null);
  useEffect(() => {
    if (!sansOdf || !editable) return;
    let annule = false;
    catalogueTrace().then((c) => {
      if (!annule) setCatalogue(c);
    });
    return () => {
      annule = true;
    };
  }, [sansOdf, editable]);
  const semiFinis = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of fiche.lignesRegroupees) for (const sf of l.semiFinis) m.set(sf.id, sf.nom);
    for (const sf of catalogue?.semiFinis ?? []) m.set(sf.id, sf.nom);
    for (const p of trace.pieces) m.set(p.semiFiniId, p.semiFiniNom);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [fiche.lignesRegroupees, trace.pieces, catalogue]);
  const tailles = useMemo(() => {
    const t = new Set<string>();
    for (const l of fiche.lignesRegroupees) for (const x of l.tailles) t.add(x);
    for (const x of catalogue?.tailles ?? []) t.add(x);
    for (const p of trace.pieces) t.add(p.taille);
    // Ordre du référentiel quand il est connu (XS avant S), sinon alphabétique.
    const ordre = catalogue?.tailles ?? [];
    return [...t].sort((a, b) => (ordre.indexOf(a) + 1 || 999) - (ordre.indexOf(b) + 1 || 999) || a.localeCompare(b));
  }, [fiche.lignesRegroupees, trace.pieces, catalogue]);

  function run(action: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error(res.error);
      else {
        toast.success(ok);
        onChanged();
      }
    });
  }

  const modifie = JSON.stringify(lignes) !== JSON.stringify(depuisTrace());
  const c = trace.controle;
  const peutDeroger = canUnlock && !archived && c.statut === "ecart" && !c.derogationMotif && ["previsionnel", "en_preparation", "bon_pour_coupe"].includes(trace.statut);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Pièces du tracé (quantité posée par couche)</p>
        {c.statut === "conforme" && (
          <Badge tone="success" dot>
            Conforme au fichier du tracé
          </Badge>
        )}
        {c.statut === "ecart" && (
          <Badge tone={c.derogationMotif ? "warning" : "danger"} dot>
            {c.derogationMotif ? "Écart accepté par dérogation" : "Écart avec le fichier du tracé"}
          </Badge>
        )}
        {c.statut === "non_verifie" && <Badge tone="neutral">Sans contrôle du tracé</Badge>}
      </div>

      {lignes.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Aucune pièce. {trace.analyse ? "Pré-remplissez-les depuis le fichier du tracé ou ajoutez-les à la main." : "Déposez le fichier du tracé pour les pré-remplir, ou ajoutez-les à la main."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lignes.map((l, i) => {
            const source = trace.pieces.find((p) => p.semiFiniId === l.semiFiniId && p.taille === l.taille)?.source;
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <select
                  value={l.semiFiniId}
                  disabled={!editable}
                  onChange={(e) => setLignes((v) => v.map((x, j) => (j === i ? { ...x, semiFiniId: e.target.value } : x)))}
                  className="h-8 min-w-40 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
                  aria-label="Semi-fini"
                >
                  <option value="">— Semi-fini —</option>
                  {semiFinis.map(([id, nom]) => (
                    <option key={id} value={id}>
                      {nom}
                    </option>
                  ))}
                </select>
                <select
                  value={l.taille}
                  disabled={!editable}
                  onChange={(e) => setLignes((v) => v.map((x, j) => (j === i ? { ...x, taille: e.target.value } : x)))}
                  className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
                  aria-label="Taille"
                >
                  <option value="">— Taille —</option>
                  {tailles.map((t) => (
                    <option key={t} value={t}>
                      {libelleTaille(t)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={l.quantite}
                  disabled={!editable}
                  onChange={(e) => setLignes((v) => v.map((x, j) => (j === i ? { ...x, quantite: e.target.value } : x)))}
                  className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm disabled:opacity-60"
                  aria-label="Quantité par couche"
                />
                {source && <span className="text-xs text-foreground-muted">{source === "dxf" ? "lu dans le fichier" : "saisi"}</span>}
                {editable && (
                  <button
                    type="button"
                    onClick={() => setLignes((v) => v.filter((_, j) => j !== i))}
                    className="text-foreground-muted hover:text-danger"
                    aria-label="Retirer cette pièce"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={() => setLignes((v) => [...v, { semiFiniId: "", taille: "", quantite: "1" }])}>
              <Plus className="h-3.5 w-3.5" /> Ajouter une pièce
            </Button>
            {trace.analyse && (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                loading={pending}
                onClick={() =>
                  run(async () => {
                    const res = await preRemplirPiecesTrace(trace.id, fiche.id);
                    return res.error ? { error: res.error } : {};
                  }, "Pièces pré-remplies depuis le fichier du tracé")
                }
              >
                <FileSearch className="h-3.5 w-3.5" /> Pré-remplir depuis le fichier
              </Button>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            loading={pending}
            disabled={!modifie}
            onClick={() =>
              run(
                () =>
                  enregistrerPiecesTrace(
                    trace.id,
                    fiche.id,
                    lignes.map((l) => ({ semiFiniId: l.semiFiniId, taille: l.taille, quantite: Math.trunc(Number(l.quantite) || 0) }))
                  ),
                "Pièces enregistrées"
              )
            }
          >
            Enregistrer les pièces
          </Button>
        </div>
      )}

      {c.statut === "ecart" && c.detail && (
        <div className="space-y-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-foreground">
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> Ce que le fichier contient ne correspond pas aux pièces déclarées
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {c.detail.ecarts.map((e, i) => (
              <li key={i}>
                {e.semi_fini} {libelleTaille(e.taille)} : déclaré {e.declare}, dans le fichier {e.reconnu}
              </li>
            ))}
            {c.detail.hors_semi_fini.map((e, i) => (
              <li key={`h${i}`}>
                {e.semi_fini} {libelleTaille(e.taille)} : pièce d&apos;un ancien patron de produit fini (à migrer vers ses semi-finis)
              </li>
            ))}
            {c.detail.quantites_non_entieres.map((e, i) => (
              <li key={`q${i}`}>
                {e.semi_fini} {libelleTaille(e.taille)} : le nombre de pièces du fichier n&apos;est pas un nombre entier d&apos;exemplaires du patron
              </li>
            ))}
            {c.detail.pieces_non_reconnues > 0 && (
              <li>
                {c.detail.pieces_non_reconnues} pièce{c.detail.pieces_non_reconnues > 1 ? "s" : ""} du fichier non reconnue{c.detail.pieces_non_reconnues > 1 ? "s" : ""} dans la bibliothèque de patrons
              </li>
            )}
          </ul>
          <p className="text-foreground-muted">Le tracé ne peut pas passer « Bon pour coupe » tant que cet écart n&apos;est pas corrigé ou accepté par un responsable.</p>
        </div>
      )}
      {c.derogationMotif && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <CheckCircle2 className="h-3.5 w-3.5" /> Dérogation{c.derogationLe ? ` du ${new Date(c.derogationLe).toLocaleDateString("fr-FR")}` : ""} : {c.derogationMotif}
        </p>
      )}
      {peutDeroger && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Motif de la dérogation (obligatoire)"
            className="h-8 min-w-64 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
          />
          <Button
            size="sm"
            variant="secondary"
            type="button"
            loading={pending}
            disabled={!motif.trim()}
            onClick={() => run(() => derogerControleTrace(trace.id, fiche.id, motif.trim()), "Dérogation enregistrée")}
          >
            Accepter l&apos;écart
          </Button>
        </div>
      )}
    </div>
  );
}

/** Couches d'un tracé regroupé par article (plis = somme), modifiables en préparation. */
export function CouchesEditor({
  fiche,
  trace,
  editable,
  onChanged,
}: {
  fiche: FichePlacement;
  trace: TracePlacement;
  editable: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [valeurs, setValeurs] = useState<Record<string, string>>(
    Object.fromEntries(fiche.lignesRegroupees.map((l) => [l.lineId, String(trace.couches.find((c) => c.lineId === l.lineId)?.nbCouches ?? "")]))
  );
  const total = Object.values(valeurs).reduce((s, v) => s + (Number(v) || 0), 0);
  const semiFinisTrace = [...new Map(trace.pieces.map((p) => [p.semiFiniId, p.semiFiniNom])).entries()];
  // D1 : un article sans toutes les pièces du tracé ne reçoit pas de couches.
  const manquants = (l: FichePlacement["lignesRegroupees"][number]) =>
    semiFinisTrace.filter(([id]) => !l.semiFinis.some((x) => x.id === id)).map(([, nom]) => nom);

  function enregistrer() {
    startTransition(async () => {
      const res = await enregistrerCouches(
        trace.id,
        fiche.id,
        Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, Math.trunc(Number(v) || 0)]))
      );
      if (res.error) toast.error(res.error);
      else {
        toast.success("Couches enregistrées");
        onChanged();
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs font-medium text-foreground">Couches par article (total {total} = nombre de plis du tracé)</p>
      <ul className="space-y-1.5">
        {fiche.lignesRegroupees.map((l) => {
          const manque = manquants(l);
          return (
            <li key={l.lineId} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">
                  {l.odfAnnule && <span className="mr-1.5 rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">ODF annulé</span>}
                  {l.odfReference ?? "—"} · {l.description}
                  {(() => {
                    const c = [...new Set(l.semiFinis.filter((p) => semiFinisTrace.some(([id]) => id === p.id)).map((p) => p.couleur ?? "sans couleur"))];
                    return c.length > 0 ? ` · ${c.join(", ")}` : l.couleur ? ` · ${l.couleur}` : "";
                  })()}
                </span>
                {manque.length > 0 && (
                  <span className="block text-xs text-danger">Pas de couches possibles : sa nomenclature n&apos;a pas {manque.join(", ")}.</span>
                )}
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={valeurs[l.lineId] ?? ""}
                disabled={!editable || manque.length > 0}
                onChange={(e) => setValeurs((v) => ({ ...v, [l.lineId]: e.target.value }))}
                className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm disabled:opacity-60"
                aria-label={`Couches pour ${l.description}`}
              />
            </li>
          );
        })}
      </ul>
      {(trace.compositionTissus ?? []).length > 0 && (
        <div className="rounded-md bg-surface-muted px-3 py-2">
          <p className="text-xs font-medium text-foreground">Composition du matelas par tissu</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {(trace.compositionTissus ?? []).map((t) => (
              <li key={t.libelle}>
                <span className="font-medium">{t.libelle}</span> : {t.couches} couche{t.couches > 1 ? "s" : ""}
                <span className="block text-xs text-foreground-muted">{t.odfs}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editable && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" loading={pending} onClick={enregistrer}>
            Enregistrer les couches
          </Button>
        </div>
      )}
    </div>
  );
}
