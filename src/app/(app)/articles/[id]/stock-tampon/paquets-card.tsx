"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { lignesCompatibles, reorienterPaquet, type LigneCompatible } from "./actions";

export interface PaquetRow {
  lot_id: string;
  code: string;
  odf: string;
  article: string | null;
  composition_taille: Record<string, number>;
  detenteur: string | null;
  en_transit: boolean;
  verrouille: boolean;
}

const tailleTexte = (c: Record<string, number>) =>
  Object.entries(c ?? {})
    .filter(([, n]) => Number(n) > 0)
    .map(([t, n]) => `${n} ${t.split("/").pop()}`)
    .join(", ");

/**
 * Paquets de pièces d'un semi-fini (étape 4b, migration 0153) : où ils sont
 * (atelier détenteur, en transit), leur verrou, et la réorientation vers une
 * autre ligne d'ODF pour les chefs de production (S48).
 */
export function PaquetsCard({ paquets, semiFiniId, canReorienter }: { paquets: PaquetRow[]; semiFiniId: string; canReorienter: boolean }) {
  const [choisi, setChoisi] = useState<PaquetRow | null>(null);
  return (
    <Card>
      <CardHeader
        title="Paquets (lots QR)"
        description="Un paquet par article d'ODF et par taille, créé à la clôture d'un matelas regroupé. Un paquet suit l'atelier qui l'a scanné en dernier ; verrouillé dès son entrée en personnalisation."
      />
      <CardBody className="p-0">
        {paquets.length === 0 ? (
          <p className="px-5 py-4 text-sm text-foreground-muted">Aucun paquet en cours.</p>
        ) : (
          <ul className="divide-y divide-border">
            {paquets.map((p) => (
              <li key={p.lot_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  <span className="font-mono text-xs">{p.code}</span> · {p.odf}
                  {p.article ? ` · ${p.article}` : ""} · {tailleTexte(p.composition_taille)}
                  <span className="block text-xs text-foreground-muted">
                    {p.en_transit ? "En transit" : `Chez ${p.detenteur ?? "—"}`}
                    {p.verrouille ? " · verrouillé (personnalisation)" : ""}
                  </span>
                </span>
                {canReorienter && !p.verrouille && (
                  <Button size="sm" variant="secondary" onClick={() => setChoisi(p)}>
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Réorienter
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {choisi && <ReorienterDialog paquet={choisi} semiFiniId={semiFiniId} onClose={() => setChoisi(null)} />}
    </Card>
  );
}

function ReorienterDialog({ paquet, semiFiniId, onClose }: { paquet: PaquetRow; semiFiniId: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lignes, setLignes] = useState<LigneCompatible[] | null>(null);
  const [cible, setCible] = useState("");
  const [motif, setMotif] = useState("");
  const tailles = Object.entries(paquet.composition_taille ?? {}).filter(([, n]) => Number(n) > 0);
  const [quantites, setQuantites] = useState<Record<string, string>>(Object.fromEntries(tailles.map(([t, n]) => [t, String(n)])));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    lignesCompatibles(paquet.code).then((res) => {
      if (annule) return;
      if ("error" in res) setError(res.error);
      else setLignes(res);
    });
    return () => {
      annule = true;
    };
  }, [paquet.code]);

  function valider() {
    setError(null);
    startTransition(async () => {
      const composition = Object.fromEntries(
        Object.entries(quantites)
          .map(([t, v]) => [t, Math.trunc(Number(v) || 0)] as [string, number])
          .filter(([, n]) => n > 0)
      );
      const res = await reorienterPaquet(paquet.code, cible, composition, motif, semiFiniId);
      if (res.error) setError(res.error);
      else {
        toast.success(`Paquet ${res.code} réorienté`);
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Réorienter ${paquet.code}`} description={`${paquet.odf} · ${tailleTexte(paquet.composition_taille)}`}>
      <div className="space-y-3">
        <p className="text-xs text-foreground-muted">
          Vers une ligne d&apos;ODF en production qui a besoin de la même pièce, dans la même couleur et le même tissu. Seules les pièces pas encore assemblées en t-shirts
          se réorientent ; une partie du paquet devient un sous-lot (nouvelle étiquette).
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <label className="block space-y-1 text-xs font-medium text-foreground">
          Ligne d&apos;ODF de destination
          <select value={cible} onChange={(e) => setCible(e.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm">
            <option value="">{lignes === null ? "Recherche…" : lignes.length === 0 ? "Aucune ligne compatible" : "— Choisir —"}</option>
            {(lignes ?? []).map((l) => (
              <option key={l.lineId} value={l.lineId}>
                {l.odf} · {l.article}
                {l.couleur ? ` · ${l.couleur}` : ""} — reste à couper {l.reste}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {tailles.map(([t, n]) => (
            <label key={t} className="space-y-1 text-xs text-foreground-muted">
              {t.split("/").pop()} (max {n})
              <input
                inputMode="numeric"
                value={quantites[t] ?? ""}
                onChange={(e) => setQuantites((q) => ({ ...q, [t]: e.target.value }))}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              />
            </label>
          ))}
        </div>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          Motif (obligatoire)
          <textarea rows={2} value={motif} onChange={(e) => setMotif(e.target.value)} className="w-full rounded-md border border-border bg-surface p-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={pending} disabled={!cible || !motif.trim()} onClick={valider}>
            Réorienter
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
