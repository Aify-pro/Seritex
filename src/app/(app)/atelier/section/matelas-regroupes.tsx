"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Layers, Printer, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { LotCodeInput } from "@/components/atelier/lot-code-input";
import { attachRollToMatelasRegroupe, cloturerMatelasCouleurs, demarrerMatelas } from "./actions";
import type { MatelasRoll } from "./matelas-rolls";

/** Matelas regroupé à couper (étapes 3b et 3c) : une ou plusieurs pièces (semi-finis), des couches par article d'ODF. */
export interface MatelasRegroupe {
  traceId: string;
  /** Ordre de tracé du matelas : sa fiche matelas imprimable (PDF). */
  ficheId: string;
  reference: string;
  /** Noms des pièces du tracé, pour l'affichage. */
  semiFini: string;
  statut: string;
  /** Forme du tissu du tracé (0163). */
  forme: string;
  /** Rouleaux choisis par la PAO, et rouleaux déjà scannés. */
  rouleauxPrevus: string[];
  rouleauxScannes: MatelasRoll[];
  /** Pièces posées par couche : semi-fini × taille × quantité. */
  pieces: { semiFiniId: string; semiFini: string; taille: string; quantiteParCouche: number }[];
  longueurCm: number | null;
  laizeCm: number | null;
  /** odfAnnule (0178) : article d'un ODF annulé — ses pièces iront en stock tampon, à réorienter. */
  articles: { lineId: string; odf: string; article: string; couleur: string | null; couches: number; odfAnnule?: boolean }[];
  /** Couches par tissu (grammage, couleur, référence) et ODF concernés. */
  tissus: { libelle: string; couches: number; odfs: string }[];
  /** Plis par couleur et grammage (0183). */
  plis: { cle: string; libelle: string; nbPlis: number }[];
  /** Couches attribuées par article et par pièce (0183). */
  couchesPieces: { lineId: string; semiFiniId: string; cle: string; nbCouches: number }[];
}

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;
const inputClass = "h-10 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30";
const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));

/**
 * Matelas regroupés de la section Coupe (étapes 3b et 3c, migrations 0150 et
 * 0155) : un matelas porte une ou plusieurs pièces (semi-finis) pour plusieurs
 * articles d'ODF, chaque couche appartenant à un article. À la clôture, on
 * saisit par article les couches réellement matelassées et les pièces
 * obtenues par pièce et par taille ; tout
 * manque est justifié (aucune tolérance). Les t-shirts complets sont ensuite
 * déclarés automatiquement sur la Coupe de chaque article. À la clôture, un
 * paquet QR par article × taille est créé et sa planche d'étiquettes s'ouvre
 * (étape 4b).
 */
export function MatelasRegroupes({ matelas }: { matelas: MatelasRegroupe[] }) {
  const [ouvert, setOuvert] = useState<MatelasRegroupe | null>(null);
  if (matelas.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Matelas regroupés"
        description="Des pièces coupées pour plusieurs articles d'ODF : chaque couche appartient à un article (tissu, couleur, grammage). À la clôture, pièces obtenues article par article."
      />
      <CardBody className="p-0">
        <ul className="divide-y divide-border">
          {matelas.map((m) => (
            <li key={m.traceId}>
              <button type="button" onClick={() => setOuvert(m)} className="flex min-h-12 w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-surface-muted">
                <Layers className="h-4 w-4 shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m.reference}</span>
                    <span className="text-xs text-foreground-muted">{m.semiFini}</span>
                    {m.forme === "tubulaire" && <span className="rounded-sm bg-info-soft px-1.5 py-0.5 text-[10px] font-medium text-info">tubulaire</span>}
                    {m.statut === "en_coupe" && (
                      <span className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">en coupe</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-foreground-muted">
                    {m.articles.map((a) => `${a.odf}${a.odfAnnule ? " (ODF annulé)" : ""} · ${a.couches} couches${a.couleur ? ` ${a.couleur}` : ""}`).join(" — ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
      {ouvert && <MatelasRegroupeDialog matelas={ouvert} onClose={() => setOuvert(null)} />}
    </Card>
  );
}

function MatelasRegroupeDialog({ matelas, onClose }: { matelas: MatelasRegroupe; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [demarre, setDemarre] = useState(matelas.statut === "en_coupe");
  const pieces0 = matelas.pieces.filter((p) => p.quantiteParCouche > 0);
  // 0183 : plis réels par couleur ; pièces obtenues par article × pièce × taille,
  // préremplies au prévu (quantité par couche × couches de l'article sur cette
  // pièce), à l'échelle des plis réels de chaque couleur.
  const [plisReels, setPlisReels] = useState<Record<string, string>>(Object.fromEntries(matelas.plis.map((p) => [p.cle, String(p.nbPlis)])));
  const prevu = (lineId: string, semiFiniId: string, taille: string, reels?: Record<string, string>) => {
    const qpc = pieces0.find((p) => p.semiFiniId === semiFiniId && p.taille === taille)?.quantiteParCouche ?? 0;
    return matelas.couchesPieces
      .filter((c) => c.lineId === lineId && c.semiFiniId === semiFiniId)
      .reduce((s, c) => {
        const plis = matelas.plis.find((p) => p.cle === c.cle)?.nbPlis ?? 0;
        const ratio = reels && plis > 0 ? Math.min(1, Math.max(0, num(reels[c.cle] ?? "") || 0) / plis) : 1;
        return s + Math.floor(qpc * c.nbCouches * ratio);
      }, 0);
  };
  // Lignes de saisie : article × pièce × taille effectivement attribués.
  const lignesSaisie = matelas.articles.flatMap((a) =>
    pieces0
      .filter((p) => matelas.couchesPieces.some((c) => c.lineId === a.lineId && c.semiFiniId === p.semiFiniId))
      .map((p) => ({ article: a, semiFiniId: p.semiFiniId, piece: p.semiFini, taille: p.taille }))
  );
  const cleSaisie = (l: { article: { lineId: string }; semiFiniId: string; taille: string }) => `${l.article.lineId}|${l.semiFiniId}|${l.taille}`;
  const preremplir = (reels?: Record<string, string>) => Object.fromEntries(lignesSaisie.map((l) => [cleSaisie(l), String(prevu(l.article.lineId, l.semiFiniId, l.taille, reels))]));
  const [obtenus, setObtenus] = useState<Record<string, string>>(preremplir());
  const [longueur, setLongueur] = useState(matelas.longueurCm ? String(matelas.longueurCm) : "");
  const [laize, setLaize] = useState(matelas.laizeCm ? String(matelas.laizeCm) : "");
  const [poids, setPoids] = useState("");
  const [dechets, setDechets] = useState("");
  const [justification, setJustification] = useState("");
  const [codeRouleau, setCodeRouleau] = useState("");
  const [rouleaux, setRouleaux] = useState<MatelasRoll[]>(matelas.rouleauxScannes);
  const aScanner = matelas.rouleauxPrevus.filter((c) => !rouleaux.some((r) => r.code === c));

  function scannerRouleau() {
    setError(null);
    startTransition(async () => {
      const res = await attachRollToMatelasRegroupe(codeRouleau, matelas.traceId);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.roll) {
        const roll = res.roll;
        setRouleaux((prev) => (prev.some((r) => r.code === roll.code) ? prev : [...prev, roll]));
        if (!laize.trim() && roll.laizeCm) setLaize(String(roll.laizeCm));
      }
      setCodeRouleau("");
    });
  }

  const manque =
    matelas.plis.some((p) => num(plisReels[p.cle] ?? "") < p.nbPlis) ||
    lignesSaisie.some((l) => num(obtenus[cleSaisie(l)] ?? "") < prevu(l.article.lineId, l.semiFiniId, l.taille));
  const mesuresOk = num(longueur) > 0 && num(laize) > 0 && num(poids) > 0 && num(dechets) >= 0;

  function setPlisCouleur(cleCouleur: string, v: string) {
    const nouveaux = { ...plisReels, [cleCouleur]: v };
    setPlisReels(nouveaux);
    // Les pièces suivent les plis réels de chaque couleur.
    setObtenus(preremplir(nouveaux));
  }

  function cloturer() {
    setError(null);
    startTransition(async () => {
      const res = await cloturerMatelasCouleurs(
        matelas.traceId,
        Object.fromEntries(matelas.plis.map((p) => [p.cle, Math.trunc(num(plisReels[p.cle] ?? "")) || 0])),
        lignesSaisie.map((l) => ({ lineId: l.article.lineId, semiFiniId: l.semiFiniId, taille: l.taille, obtenus: Math.trunc(num(obtenus[cleSaisie(l)] ?? "0")) || 0 })),
        { longueurCm: num(longueur), laizeCm: num(laize), poidsTissuKg: num(poids), dechetsKg: num(dechets) },
        justification
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      const assembles = Object.values(res.kits ?? {}).reduce((s, n) => s + Number(n || 0), 0);
      toast.success(`${matelas.reference} clôturé${assembles ? ` — ${assembles} t-shirt(s) complet(s) déclaré(s)` : ""}`);
      // Étape 4b : un paquet QR par article × taille — la planche d'étiquettes s'ouvre aussitôt.
      window.open(`/api/atelier/matelas-regroupe/${matelas.traceId}/etiquettes`, "_blank", "noopener");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={matelas.reference} description={`Matelas regroupé — ${matelas.semiFini}`} size="lg">
      <div className="space-y-5">
        {error && (
          <div className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        <a
          href={`/api/patronnage/fiches/${matelas.ficheId}/pdf?trace=${matelas.traceId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          <Printer className="h-4 w-4" /> Fiche matelas (PDF)
        </a>
        {matelas.tissus.length > 0 && (
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Composition du matelas</p>
            <ul className="mt-1 space-y-1 text-sm">
              {matelas.tissus.map((t) => (
                <li key={t.libelle}>
                  <span className="font-medium">{t.libelle}</span> : {t.couches} couche{t.couches > 1 ? "s" : ""}
                  <span className="block text-xs text-foreground-muted">{t.odfs}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-foreground-muted">
          Pièces par couche : {pieces0.map((p) => `${p.quantiteParCouche} ${p.semiFini} ${libelleTaille(p.taille)}`).join(", ") || "—"}. Jamais plus que le tracé ; tout manque est justifié.
        </p>

        {/* Plis réels par couleur (et grammage) : une couche = un tissu d'une couleur. */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Plis réels par couleur</p>
          {matelas.plis.length === 0 ? (
            <p className="text-xs text-warning">Ce matelas n&apos;a pas de plis par couleur : la PAO doit les saisir sur le tracé.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {matelas.plis.map((p) => (
                <label key={p.cle} className="space-y-1 text-xs text-foreground-muted">
                  {p.libelle} <span className="text-foreground-muted">({p.nbPlis} prévus)</span>
                  <input inputMode="numeric" value={plisReels[p.cle] ?? ""} onChange={(e) => setPlisCouleur(p.cle, e.target.value)} className={inputClass} />
                </label>
              ))}
            </div>
          )}
        </section>

        {/* Pièces obtenues par article, pièce et taille. */}
        {matelas.articles.map((a) => {
          const lignes = lignesSaisie.filter((l) => l.article.lineId === a.lineId);
          if (lignes.length === 0) return null;
          return (
            <section key={a.lineId} className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">
                {a.odf} · {a.article}
                {a.couleur ? ` · ${a.couleur}` : ""}
              </p>
              {a.odfAnnule && (
                <p className="rounded bg-danger-soft px-2 py-1 text-xs text-danger">
                  ODF annulé : les pièces coupées pour cet article restent en stock tampon, à réorienter vers un autre ODF.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {lignes.map((l) => (
                  <label key={cleSaisie(l)} className="space-y-1 text-xs text-foreground-muted">
                    {l.piece} {libelleTaille(l.taille)} <span>(prévu {prevu(l.article.lineId, l.semiFiniId, l.taille)})</span>
                    <input
                      inputMode="numeric"
                      value={obtenus[cleSaisie(l)] ?? ""}
                      onChange={(e) => setObtenus((o) => ({ ...o, [cleSaisie(l)]: e.target.value }))}
                      className={inputClass}
                    />
                  </label>
                ))}
              </div>
            </section>
          );
        })}

        <section className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs text-foreground-muted">
            Rouleau(x) utilisé(s) — tissu {matelas.forme}. Scannez l&apos;étiquette du rouleau, sorti au préalable par la gestion de stock.
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <LotCodeInput kind="roll" value={codeRouleau} onChange={setCodeRouleau} disabled={pending} placeholder="ROL-AAAA-NNNNN" />
            </div>
            <Button size="md" variant="secondary" loading={pending} disabled={!codeRouleau.trim()} onClick={scannerRouleau}>
              Ajouter
            </Button>
          </div>
          {aScanner.length > 0 && <p className="text-xs text-foreground-muted">Prévu(s) par la PAO : <span className="font-mono">{aScanner.join(", ")}</span></p>}
          {rouleaux.length > 0 && (
            <ul className="space-y-1 text-sm">
              {rouleaux.map((r) => (
                <li key={r.code} className="flex flex-wrap gap-x-3">
                  <span className="font-mono text-xs">{r.code}</span>
                  <span className="text-foreground-muted">{r.laizeCm ? `${r.laizeCm} cm` : "laize —"}</span>
                  <span className="text-foreground-muted">bain {r.bain ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
          {new Set(rouleaux.map((r) => r.bain ?? "—")).size > 1 && <p className="text-xs text-warning">Attention : plusieurs bains sur ce matelas (risque de nuance).</p>}
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="space-y-1 text-xs text-foreground-muted">
            Longueur (cm)
            <input inputMode="decimal" value={longueur} onChange={(e) => setLongueur(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-foreground-muted">
            Laize (cm)
            <input inputMode="decimal" value={laize} onChange={(e) => setLaize(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-foreground-muted">
            Tissu utilisé (kg)
            <input inputMode="decimal" value={poids} onChange={(e) => setPoids(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-foreground-muted">
            Déchets (kg)
            <input inputMode="decimal" value={dechets} onChange={(e) => setDechets(e.target.value)} className={inputClass} />
          </label>
        </section>
        <p className="text-[11px] text-foreground-muted">Tissu et déchets sont répartis entre les articles au prorata des pièces obtenues.</p>

        {manque && (
          <label className="block space-y-1 text-xs text-foreground-muted">
            Justification du manque (obligatoire)
            <textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} className="w-full rounded-md border border-border bg-surface p-2 text-base" />
          </label>
        )}

        <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2 border-t border-border bg-surface px-5 py-3">
          {!demarre && (
            <Button
              variant="secondary"
              className="w-full"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await demarrerMatelas(matelas.traceId);
                  if (res.error) setError(res.error);
                  else {
                    setDemarre(true);
                    toast.success(`${matelas.reference} : coupe démarrée`);
                  }
                })
              }
            >
              <Scissors className="h-4 w-4" /> Démarrer le matelas
            </Button>
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button className="w-full sm:w-auto" loading={pending} disabled={!mesuresOk || (manque && !justification.trim())} onClick={cloturer}>
              Clôturer le matelas
            </Button>
            <Button variant="ghost" className="w-full sm:w-auto" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
