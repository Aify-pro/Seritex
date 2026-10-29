"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Layers, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { cloturerMatelasRegroupe, demarrerMatelas } from "./actions";

/** Matelas regroupé à couper (étape 3b) : un semi-fini, des couches par article d'ODF. */
export interface MatelasRegroupe {
  traceId: string;
  reference: string;
  semiFini: string;
  statut: string;
  repartitionParCouche: Record<string, number>;
  longueurCm: number | null;
  laizeCm: number | null;
  articles: { lineId: string; odf: string; article: string; couleur: string | null; couches: number }[];
}

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;
const inputClass = "h-10 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30";
const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));

/**
 * Matelas regroupés de la section Coupe (étape 3b, migration 0150) : un
 * matelas porte une seule pièce (semi-fini) pour plusieurs articles d'ODF,
 * chaque couche appartenant à un article. À la clôture, on saisit par article
 * les couches réellement matelassées et les pièces obtenues par taille ; tout
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
        description="Une pièce coupée pour plusieurs articles d'ODF : chaque couche appartient à un article (tissu, couleur, grammage). À la clôture, pièces obtenues article par article."
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
                    {m.statut === "en_coupe" && (
                      <span className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">en coupe</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-foreground-muted">
                    {m.articles.map((a) => `${a.odf} · ${a.couches} couches${a.couleur ? ` ${a.couleur}` : ""}`).join(" — ")}
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
  const tailles = Object.entries(matelas.repartitionParCouche).filter(([, n]) => Number(n) > 0);
  // Par article : couches réelles et pièces obtenues par taille, préremplies au théorique.
  const [couches, setCouches] = useState<Record<string, string>>(Object.fromEntries(matelas.articles.map((a) => [a.lineId, String(a.couches)])));
  const [pieces, setPieces] = useState<Record<string, Record<string, string>>>(
    Object.fromEntries(matelas.articles.map((a) => [a.lineId, Object.fromEntries(tailles.map(([t, n]) => [t, String(Number(n) * a.couches)]))]))
  );
  const [longueur, setLongueur] = useState(matelas.longueurCm ? String(matelas.longueurCm) : "");
  const [laize, setLaize] = useState(matelas.laizeCm ? String(matelas.laizeCm) : "");
  const [poids, setPoids] = useState("");
  const [dechets, setDechets] = useState("");
  const [justification, setJustification] = useState("");

  const manque = matelas.articles.some(
    (a) => num(couches[a.lineId] ?? "") < a.couches || tailles.some(([t, n]) => num(pieces[a.lineId]?.[t] ?? "") < Number(n) * a.couches)
  );
  const mesuresOk = num(longueur) > 0 && num(laize) > 0 && num(poids) > 0 && num(dechets) >= 0;

  function setCouchesArticle(lineId: string, v: string) {
    setCouches((c) => ({ ...c, [lineId]: v }));
    // Les pièces suivent les couches réelles (répartition × couches).
    const n = Math.trunc(num(v));
    if (n > 0) setPieces((p) => ({ ...p, [lineId]: Object.fromEntries(tailles.map(([t, par]) => [t, String(Number(par) * n)])) }));
  }

  function cloturer() {
    setError(null);
    startTransition(async () => {
      const res = await cloturerMatelasRegroupe(
        matelas.traceId,
        matelas.articles.map((a) => ({
          lineId: a.lineId,
          couchesReelles: Math.trunc(num(couches[a.lineId] ?? "")),
          obtenus: Object.fromEntries(tailles.map(([t]) => [t, Math.trunc(num(pieces[a.lineId]?.[t] ?? "0")) || 0])),
        })),
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
        <p className="text-xs text-foreground-muted">
          Pièces par couche : {tailles.map(([t, n]) => `${n} ${libelleTaille(t)}`).join(", ") || "—"}. Jamais plus que le tracé ; tout manque est justifié.
        </p>

        {matelas.articles.map((a) => (
          <section key={a.lineId} className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              {a.odf} · {a.article}
              {a.couleur ? ` · ${a.couleur}` : ""} <span className="text-xs text-foreground-muted">({a.couches} couches prévues)</span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="space-y-1 text-xs text-foreground-muted">
                Couches réelles
                <input inputMode="numeric" value={couches[a.lineId] ?? ""} onChange={(e) => setCouchesArticle(a.lineId, e.target.value)} className={inputClass} />
              </label>
              {tailles.map(([t]) => (
                <label key={t} className="space-y-1 text-xs text-foreground-muted">
                  Pièces {libelleTaille(t)}
                  <input
                    inputMode="numeric"
                    value={pieces[a.lineId]?.[t] ?? ""}
                    onChange={(e) => setPieces((p) => ({ ...p, [a.lineId]: { ...p[a.lineId], [t]: e.target.value } }))}
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
          </section>
        ))}

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
        <p className="text-[11px] text-foreground-muted">Tissu et déchets sont répartis entre les articles au prorata de leurs couches.</p>

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
