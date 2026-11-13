"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import type { FichePlacement, TracePlacement } from "@/lib/patronnage/types";
import {
  articlesOrdre,
  calculerDispatching,
  couleursDuTrace,
  libelleTaille,
  repartirPlis,
  type ArticleOrdre,
} from "@/lib/patronnage/dispatching-ordre";
import {
  ajouterArticleOrdre,
  ajouterLigneRegroupee,
  besoinsCoupe,
  couleursArticleOrdre,
  enregistrerPlisCouleur,
  lignesOdfDuModele,
  modeleArticleOrdre,
  remplacerArticleOrdre,
  retirerArticleOrdre,
  retirerLigneRegroupee,
  type BesoinCoupeGroupe,
  type ModeleArticleOrdre,
} from "@/app/(app)/atelier/patronnage/fiches-actions";

const champ = "h-9 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ error?: string }>, ok: string, apres?: () => void) =>
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error(res.error);
      else {
        toast.success(ok);
        apres?.();
        router.refresh();
      }
    });
  return { pending, run };
}

const taillesTexte = (t: Record<string, number>) =>
  Object.entries(t)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${libelleTaille(k)} ${n}`)
    .join(" · ");

/* ============================================================
   Articles à produire (demande de l'ordre)
============================================================ */

/**
 * Articles à produire (refonte du 2026-11-12) : la demande de l'ordre. Les
 * articles d'ODF arrivent avec leurs quantités et leurs couleurs ; sans ODF,
 * on saisit les articles (modèle, couleur unique ou par zone, quantités par
 * taille). Un ordre ne mélange pas les types de tissu (grammage et couleur
 * libres). Quand l'ODF arrive, l'article saisi est remplacé par l'article
 * d'ODF.
 */
export function ArticlesOrdreCard({
  fiche,
  canModify,
  productModels,
}: {
  fiche: FichePlacement;
  canModify: boolean;
  productModels: { id: string; name: string }[];
}) {
  const { pending, run } = useAction();
  const [groupes, setGroupes] = useState<BesoinCoupeGroupe[] | null>(null);
  const [ajoutOdf, setAjoutOdf] = useState("");
  const [saisie, setSaisie] = useState(false);
  const articles = articlesOrdre(fiche);
  const dansOrdre = useMemo(() => new Set(fiche.lignesRegroupees.map((l) => l.lineId)), [fiche.lignesRegroupees]);

  useEffect(() => {
    if (!canModify) return;
    let annule = false;
    besoinsCoupe().then((res) => {
      if (!annule && !("error" in res)) setGroupes(res);
    });
    return () => {
      annule = true;
    };
  }, [canModify, fiche.lignesRegroupees.length]);

  // Articles d'ODF qui ont encore des pièces à couper et ne sont pas dans l'ordre.
  const candidats = useMemo(() => {
    const m = new Map<string, { lineId: string; libelle: string }>();
    for (const g of groupes ?? []) {
      for (const l of g.lignes) {
        if (dansOrdre.has(l.lineId) || l.dejaEntier || l.reste <= 0) continue;
        m.set(l.lineId, { lineId: l.lineId, libelle: `${l.odf} · ${l.article}` });
      }
    }
    return [...m.values()].sort((a, b) => a.libelle.localeCompare(b.libelle));
  }, [groupes, dansOrdre]);

  return (
    <Card>
      <CardHeader
        title="Articles à produire"
        description="La demande de l'ordre : articles d'ODF (quantités et couleurs de l'ODF) ou saisis sans ODF. Un seul type de tissu par ordre ; le grammage et la couleur restent libres."
        action={fiche.tissuOrdre ? <span className="rounded-md bg-surface-muted px-2 py-1 text-xs font-medium text-foreground">Tissu : {fiche.tissuOrdre}</span> : undefined}
      />
      <CardBody className="space-y-3">
        {articles.length === 0 ? (
          <p className="rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-sm text-foreground">
            Aucun article. Ajoutez un article d&apos;ODF, ou saisissez les articles à produire si l&apos;ODF n&apos;existe pas encore.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {articles.map((a) => (
              <LigneArticle key={a.cle} fiche={fiche} article={a} canModify={canModify} pending={pending} run={run} />
            ))}
          </ul>
        )}
        {canModify && (
          <div className="flex flex-wrap items-center gap-2">
            {candidats.length > 0 && (
              <>
                <select value={ajoutOdf} onChange={(e) => setAjoutOdf(e.target.value)} className={`${champ} min-w-64`}>
                  <option value="">Ajouter un article d&apos;ODF…</option>
                  {candidats.map((c) => (
                    <option key={c.lineId} value={c.lineId}>
                      {c.libelle}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!ajoutOdf}
                  loading={pending}
                  onClick={() => run(() => ajouterLigneRegroupee(fiche.id, ajoutOdf), "Article d'ODF ajouté", () => setAjoutOdf(""))}
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={() => setSaisie(true)}>
              <Plus className="h-3.5 w-3.5" /> Saisir un article (sans ODF)
            </Button>
          </div>
        )}
      </CardBody>
      {saisie && <SaisieArticleDialog ficheId={fiche.id} productModels={productModels} onClose={() => setSaisie(false)} />}
    </Card>
  );
}

function LigneArticle({
  fiche,
  article: a,
  canModify,
  pending,
  run,
}: {
  fiche: FichePlacement;
  article: ArticleOrdre;
  canModify: boolean;
  pending: boolean;
  run: (action: () => Promise<{ error?: string }>, ok: string, apres?: () => void) => void;
}) {
  const [remplacement, setRemplacement] = useState<{ lineId: string; libelle: string }[] | null>(null);
  const [choix, setChoix] = useState("");
  const pieces = [...a.pieces.values()].filter((p) => p.quantite > 0);
  return (
    <li className="space-y-1.5 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p>
            <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${a.type === "odf" ? "bg-brand-soft text-brand" : "bg-surface-muted text-foreground-muted"}`}>
              {a.origine}
            </span>
            <span className="font-medium">{a.libelle}</span>
            {a.odfAnnule && <span className="ml-1.5 rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">ODF annulé</span>}
          </p>
          <p className="text-xs text-foreground-muted">
            {Object.values(a.tailles).reduce((s, n) => s + n, 0)} vêtements : {taillesTexte(a.tailles) || "—"}
          </p>
          <p className="text-xs text-foreground-muted">
            {pieces.length === 0 ? (
              <span className="text-danger">Aucune pièce : la nomenclature de ce modèle n&apos;a pas de semi-finis.</span>
            ) : (
              pieces.map((p) => `${p.nom}${p.quantite !== 1 ? ` ×${p.quantite}` : ""} (${p.couleur ?? "sans couleur"})`).join(" · ")
            )}
          </p>
        </div>
        {canModify && (
          <button
            disabled={pending}
            onClick={() =>
              run(
                () => (a.type === "odf" ? retirerLigneRegroupee(fiche.id, a.id) : retirerArticleOrdre(fiche.id, a.id)),
                "Article retiré"
              )
            }
            className="text-foreground-muted hover:text-danger disabled:opacity-40"
            aria-label={`Retirer ${a.libelle}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {canModify && a.type === "saisi" && a.modeleId && (
        <div className="flex flex-wrap items-center gap-2">
          {remplacement === null ? (
            <button
              type="button"
              className="text-xs font-medium text-brand hover:underline"
              onClick={() => lignesOdfDuModele(a.modeleId!).then(setRemplacement)}
            >
              L&apos;ODF est arrivé : remplacer par l&apos;article d&apos;ODF…
            </button>
          ) : remplacement.length === 0 ? (
            <span className="text-xs text-foreground-muted">Aucun ODF ouvert pour ce modèle.</span>
          ) : (
            <>
              <select value={choix} onChange={(e) => setChoix(e.target.value)} className={`${champ} min-w-64`}>
                <option value="">Article d&apos;ODF…</option>
                {remplacement.map((l) => (
                  <option key={l.lineId} value={l.lineId}>
                    {l.libelle}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={!choix} loading={pending} onClick={() => run(() => remplacerArticleOrdre(fiche.id, a.id, choix), "Article remplacé par l'ODF")}>
                Remplacer
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function SaisieArticleDialog({ ficheId, productModels, onClose }: { ficheId: string; productModels: { id: string; name: string }[]; onClose: () => void }) {
  const { pending, run } = useAction();
  const [modeleId, setModeleId] = useState("");
  const [infos, setInfos] = useState<ModeleArticleOrdre | null>(null);
  const [couleurs, setCouleurs] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [nomenclatureId, setNomenclatureId] = useState("");
  const [textileId, setTextileId] = useState("");
  const [parZone, setParZone] = useState(false);
  const [couleurUnique, setCouleurUnique] = useState("");
  const [zoneColors, setZoneColors] = useState<Record<string, string>>({});
  const [tailles, setTailles] = useState<Record<string, string>>({});

  useEffect(() => {
    couleursArticleOrdre().then(setCouleurs);
  }, []);
  useEffect(() => {
    if (!modeleId) return;
    let annule = false;
    modeleArticleOrdre(modeleId).then((res) => {
      if (annule) return;
      if ("error" in res) toast.error(res.error);
      else {
        setInfos(res);
        setNomenclatureId(res.nomenclatures[0]?.id ?? "");
        setTextileId("");
        setZoneColors({});
        setTailles({});
      }
    });
    return () => {
      annule = true;
    };
  }, [modeleId]);

  function enregistrer() {
    run(
      () =>
        ajouterArticleOrdre(ficheId, {
          productModelId: modeleId,
          nomenclatureId: nomenclatureId || null,
          textileId: textileId || null,
          couleurUniqueId: parZone ? null : couleurUnique || null,
          zoneColors: parZone ? Object.fromEntries(Object.entries(zoneColors).filter(([, v]) => v)) : {},
          tailles: Object.fromEntries(Object.entries(tailles).map(([k, v]) => [k, Math.max(0, Math.trunc(Number(v) || 0))])),
        }),
      "Article ajouté",
      onClose
    );
  }

  const total = Object.values(tailles).reduce((s, v) => s + (Number(v) || 0), 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Saisir un article (sans ODF)" size="lg">
      <div className="space-y-3 text-sm">
        <label className="block space-y-1 text-xs font-medium text-foreground">
          Modèle
          <select value={modeleId} onChange={(e) => setModeleId(e.target.value)} className={`${champ} w-full`}>
            <option value="">— Choisir —</option>
            {productModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {infos && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {infos.nomenclatures.length > 1 && (
                <label className="block space-y-1 text-xs font-medium text-foreground">
                  Nomenclature
                  <select value={nomenclatureId} onChange={(e) => setNomenclatureId(e.target.value)} className={`${champ} w-full`}>
                    {infos.nomenclatures.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.nom} ({n.forme})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {infos.grammages.length > 0 && (
                <label className="block space-y-1 text-xs font-medium text-foreground">
                  Grammage
                  <select value={textileId} onChange={(e) => setTextileId(e.target.value)} className={`${champ} w-full`}>
                    <option value="">Celui du modèle</option>
                    {infos.grammages.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.libelle}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex gap-3 text-xs font-medium">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={!parZone} onChange={() => setParZone(false)} /> Couleur unique
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={parZone} disabled={infos.zones.length === 0} onChange={() => setParZone(true)} /> Couleur par zone
                  {infos.zones.length === 0 && <span className="font-normal text-foreground-muted">(le modèle n&apos;a pas de zones)</span>}
                </label>
              </div>
              {!parZone ? (
                <CouleurChoix couleurs={couleurs} valeur={couleurUnique} onChange={setCouleurUnique} />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {infos.zones.map((z) => (
                    <label key={z.key} className="space-y-1 text-xs text-foreground-muted">
                      {z.label}
                      <CouleurChoix couleurs={couleurs} valeur={zoneColors[z.key] ?? ""} onChange={(v) => setZoneColors((x) => ({ ...x, [z.key]: v }))} />
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Quantités par taille (total {total})</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {infos.tailles.map((t) => (
                  <label key={t.cle} className="space-y-1 text-xs text-foreground-muted">
                    {t.libelle}
                    <input
                      inputMode="numeric"
                      value={tailles[t.cle] ?? ""}
                      onChange={(e) => setTailles((x) => ({ ...x, [t.cle]: e.target.value }))}
                      className={`${champ} w-full text-right`}
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!modeleId || total <= 0} loading={pending} onClick={enregistrer}>
            Ajouter l&apos;article
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CouleurChoix({ couleurs, valeur, onChange }: { couleurs: { id: string; name: string; code: string | null }[]; valeur: string; onChange: (v: string) => void }) {
  const c = couleurs.find((x) => x.id === valeur);
  const hex = c?.code && /^#?[0-9a-f]{3,6}$/i.test(c.code) ? (c.code.startsWith("#") ? c.code : `#${c.code}`) : "transparent";
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="h-5 w-5 shrink-0 rounded-full border border-border" style={{ background: hex }} />
      <select value={valeur} onChange={(e) => onChange(e.target.value)} className={`${champ} w-full`}>
        <option value="">— Couleur —</option>
        {couleurs.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ============================================================
   Plis du tracé, par couleur (et grammage) — pièce par pièce
============================================================ */

/**
 * Plis d'un tracé regroupé, saisis par couleur et grammage (« 50 plis Blanc ·
 * Jersey 180 g ») : une couche donne toutes les pièces du tracé dans cette
 * couleur, et chaque pièce va aux articles qui l'ont dans cette couleur (les
 * corps blancs aux uns, les manches blanches aux autres), selon leur besoin
 * restant. Une pièce dont aucun article n'a besoin dans cette couleur reste
 * « hors demande » (signalée dans le bilan, sans bloquer).
 */
export function PlisParCouleurEditor({
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
  const groupes = useMemo(() => couleursDuTrace(fiche, trace), [fiche, trace]);
  const [valeurs, setValeurs] = useState<Record<string, string>>(Object.fromEntries(groupes.map((g) => [g.cle, g.plis ? String(g.plis) : ""])));
  const total = Object.values(valeurs).reduce((s, v) => s + (Number(v) || 0), 0);

  // Aperçu : pour chaque couleur, la répartition pièce par pièce.
  const repartition = useMemo(
    () => new Map(groupes.map((g) => [g.cle, repartirPlis(fiche, trace, g, Math.max(0, Math.trunc(Number(valeurs[g.cle]) || 0)))])),
    [groupes, valeurs, fiche, trace]
  );

  function enregistrer() {
    const plis: Record<string, number> = {};
    const couches: { lineId: string | null; articleId: string | null; semiFiniId: string; cle: string; nbCouches: number }[] = [];
    for (const g of groupes) {
      const n = Math.max(0, Math.trunc(Number(valeurs[g.cle]) || 0));
      if (n > 0) plis[g.cle] = n;
      for (const c of repartition.get(g.cle) ?? []) {
        couches.push({
          lineId: c.article.type === "odf" ? c.article.id : null,
          articleId: c.article.type === "saisi" ? c.article.id : null,
          semiFiniId: c.semiFiniId,
          cle: c.cle,
          nbCouches: c.nbCouches,
        });
      }
    }
    startTransition(async () => {
      const res = await enregistrerPlisCouleur(trace.id, fiche.id, plis, couches);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Plis enregistrés");
        onChanged();
      }
    });
  }

  if (trace.pieces.length === 0) {
    return <p className="rounded-md border border-border p-3 text-xs text-foreground-muted">Indiquez d&apos;abord les pièces du tracé : les couleurs proposées en dépendent.</p>;
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs text-foreground-muted">
        Plis par couleur et grammage (total <span className="font-medium text-foreground">{total} plis</span>). Chaque pièce d&apos;une couleur va aux articles qui
        l&apos;ont dans cette couleur.
      </p>
      {groupes.length === 0 ? (
        <p className="text-xs text-warning">Aucun article de l&apos;ordre n&apos;a les pièces de ce tracé : ajoutez les articles à produire.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {groupes.map((g) => {
            const rep = repartition.get(g.cle) ?? [];
            const n = Math.max(0, Math.trunc(Number(valeurs[g.cle]) || 0));
            return (
              <li key={g.cle} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{g.libelle}</span>
                  <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={valeurs[g.cle] ?? ""}
                      disabled={!editable}
                      onChange={(e) => setValeurs((v) => ({ ...v, [g.cle]: e.target.value }))}
                      className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm disabled:opacity-60"
                      aria-label={`Plis ${g.libelle}`}
                    />
                    plis
                  </span>
                </div>
                <ul className="grid gap-x-4 gap-y-0.5 pl-3 text-xs text-foreground-muted sm:grid-cols-2">
                  {g.pieces.map((p) => {
                    const lignes = rep.filter((c) => c.semiFiniId === p.semiFiniId);
                    return (
                      <li key={p.semiFiniId}>
                        <span className="font-medium text-foreground">{p.nom}</span> :{" "}
                        {p.articles.length === 0 ? (
                          <span className={n > 0 ? "text-danger" : ""}>aucun article dans cette couleur{n > 0 ? " (hors demande)" : ""}</span>
                        ) : lignes.length === 0 ? (
                          p.articles.map((a) => a.origine).join(", ")
                        ) : (
                          lignes.map((c) => `${c.article.origine} ${c.nbCouches}`).join(" · ")
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {editable && groupes.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" loading={pending} onClick={enregistrer}>
            Enregistrer les plis
          </Button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Dispatching et bilan des pièces
============================================================ */

const ORDRE_TAILLES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"];
/** Tri des tailles : groupe (Homme, Femme…), puis l'ordre habituel (XS avant S), puis alphabétique. */
function ordreTaille(a: string, b: string) {
  const [ga, ta] = a.includes("/") ? a.split("/") : ["", a];
  const [gb, tb] = b.includes("/") ? b.split("/") : ["", b];
  if (ga !== gb) return ga.localeCompare(gb);
  const ia = ORDRE_TAILLES.indexOf(ta);
  const ib = ORDRE_TAILLES.indexOf(tb);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0 || ib >= 0) return ia >= 0 ? -1 : 1;
  return ta.localeCompare(tb, "fr", { numeric: true });
}
const couleurEcart = (e: number) => (e < 0 ? "text-danger" : e > 0 ? "text-warning" : "text-success");

/**
 * Dispatching de l'ordre : la somme de tous les tracés (hors annulés)
 * comparée à la demande, par article et par taille. En dessous, le lien
 * « Bilan des pièces » (détail : demandé, obtenu, manquant ou en trop) et un
 * signal rouge dès qu'il manque des pièces, qu'il y en a en trop ou qui ne
 * correspondent à aucune demande.
 */
export function DispatchingCard({ fiche }: { fiche: FichePlacement }) {
  const [bilan, setBilan] = useState(false);
  const d = useMemo(() => calculerDispatching(fiche), [fiche]);
  // Tailles dans l'ordre habituel, puis articles avec leurs cellules par taille.
  const tailles = useMemo(() => [...new Set(d.lignes.map((l) => l.taille))].sort(ordreTaille), [d]);
  const parArticle = useMemo(() => {
    const m = new Map<string, { article: ArticleOrdre; cellules: Map<string, { demandes: number; obtenus: number }> }>();
    for (const l of d.lignes) {
      const e = m.get(l.article.cle) ?? { article: l.article, cellules: new Map() };
      e.cellules.set(l.taille, { demandes: l.demandes, obtenus: l.obtenus });
      m.set(l.article.cle, e);
    }
    return [...m.values()];
  }, [d]);
  if (d.lignes.length === 0) return null;
  const problemes = [
    d.manquants > 0 ? `${d.manquants} vêtement(s) manquant(s)` : null,
    d.piecesEnTrop > 0 ? `${d.piecesEnTrop} pièce(s) en trop` : null,
    d.horsDemande.length > 0 ? `${d.horsDemande.reduce((s, h) => s + h.pieces, 0)} pièce(s) hors demande` : null,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader title="Dispatching" description="Somme de tous les tracés de l'ordre (hors annulés), comparée à la demande : vêtements complets obtenus par article et par taille." />
      <CardBody className="space-y-3 p-0">
        {/* Une ligne par article, une colonne par taille : « obtenu / demandé ». */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-foreground-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Article</th>
                {tailles.map((t) => (
                  <th key={t} className="px-3 py-2 text-center font-medium">
                    {libelleTaille(t)}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {parArticle.map(({ article, cellules }) => {
                const dem = [...cellules.values()].reduce((s, c) => s + c.demandes, 0);
                const obt = [...cellules.values()].reduce((s, c) => s + c.obtenus, 0);
                return (
                  <tr key={article.cle}>
                    <td className="px-4 py-1.5">
                      <span className="text-xs text-foreground-muted">{article.origine}</span> {article.libelle}
                    </td>
                    {tailles.map((t) => {
                      const c = cellules.get(t);
                      if (!c) return <td key={t} className="px-3 py-1.5 text-center text-foreground-muted">—</td>;
                      return (
                        <td key={t} className={`px-3 py-1.5 text-center tabular-nums ${couleurEcart(c.obtenus - c.demandes)}`}>
                          {c.obtenus} <span className="text-xs text-foreground-muted">/ {c.demandes}</span>
                        </td>
                      );
                    })}
                    <td className={`px-4 py-1.5 text-right font-semibold tabular-nums ${couleurEcart(obt - dem)}`}>
                      {obt} <span className="text-xs font-normal text-foreground-muted">/ {dem}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
          <button type="button" onClick={() => setBilan(true)} className="text-sm font-medium text-brand hover:underline">
            Bilan des pièces
          </button>
          {d.ok ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Quantités atteintes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
              <AlertTriangle className="h-3.5 w-3.5" /> Erreur : {problemes.join(" · ") || "quantités non atteintes"}
            </span>
          )}
        </div>
      </CardBody>
      {bilan && (
        <Dialog open onOpenChange={(o) => !o && setBilan(false)} title="Bilan des pièces" size="lg">
          <div className="space-y-4 text-sm">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-xs text-foreground-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Article</th>
                    <th className="px-3 py-1.5 text-left font-medium">Pièce</th>
                    <th className="px-3 py-1.5 text-left font-medium">Taille</th>
                    <th className="px-3 py-1.5 text-right font-medium">Demandé</th>
                    <th className="px-3 py-1.5 text-right font-medium">Obtenu</th>
                    <th className="px-3 py-1.5 text-right font-medium">Manquant / en trop</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.pieces.map((p) => {
                    const e = p.obtenues - p.demandees;
                    return (
                      <tr key={`${p.article.cle}|${p.semiFiniId}|${p.taille}`}>
                        <td className="px-3 py-1.5 text-xs">
                          {p.article.origine} · {p.article.libelle}
                        </td>
                        <td className="px-3 py-1.5">
                          {p.piece}
                          {p.couleur ? <span className="text-xs text-foreground-muted"> ({p.couleur})</span> : null}
                        </td>
                        <td className="px-3 py-1.5">{libelleTaille(p.taille)}</td>
                        <td className="px-3 py-1.5 text-right">{p.demandees}</td>
                        <td className="px-3 py-1.5 text-right">{p.obtenues}</td>
                        <td className={`px-3 py-1.5 text-right font-medium ${e < 0 ? "text-danger" : e > 0 ? "text-warning" : "text-success"}`}>
                          {e < 0 ? `${-e} manquante(s)` : e > 0 ? `+${e} en trop` : "OK"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {d.horsDemande.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-danger">Pièces qui ne correspondent à aucune demande</p>
                <ul className="space-y-0.5 text-xs">
                  {d.horsDemande.map((h, i) => (
                    <li key={i}>
                      {h.libelle} : <span className="font-medium">{h.pieces}</span> <span className="text-foreground-muted">({h.raison})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </Card>
  );
}
