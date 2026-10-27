"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Layers, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import type { FichePlacement, TracePlacement } from "@/lib/patronnage/types";
import {
  besoinsSemiFini,
  createFicheRegroupee,
  ajouterLigneRegroupee,
  retirerLigneRegroupee,
  enregistrerCouches,
  type BesoinSemiFini,
} from "@/app/(app)/atelier/patronnage/fiches-actions";

/**
 * Ordres de coupe regroupés par pièce (étape 3a, migration 0149, décisions
 * S41-S46) : un semi-fini coupé pour plusieurs articles d'ODF, chaque couche
 * du matelas appartenant à un article (son tissu, sa couleur, son grammage).
 * La clôture pièce par pièce et l'assemblage en t-shirts viennent avec 3b.
 */

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;

function resteTexte(b: BesoinSemiFini) {
  return b.tailles
    .filter((t) => t.demandees > 0)
    .map((t) => `${libelleTaille(t.taille)} ${Math.max(t.reste, 0)}/${t.demandees}`)
    .join(" · ");
}

/** Création : choisir un semi-fini, puis les articles d'ODF qui en ont besoin (S44). */
export function NouvelOrdreRegroupeDialog({
  open,
  onOpenChange,
  semiFinis,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  semiFinis: { id: string; code: string | null; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [semiFiniId, setSemiFiniId] = useState("");
  const [besoins, setBesoins] = useState<BesoinSemiFini[] | null>(null);
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!semiFiniId) return;
    let annule = false;
    besoinsSemiFini(semiFiniId).then((res) => {
      if (annule) return;
      if ("error" in res) setError(res.error);
      else {
        setBesoins(res);
        // Préselection : articles qui ont encore des pièces à couper, pas déjà coupés en t-shirts entiers.
        setChoisis(new Set(res.filter((b) => !b.dejaEntier && b.tailles.some((t) => t.reste > 0)).map((b) => b.lineId)));
      }
    });
    return () => {
      annule = true;
    };
  }, [semiFiniId]);

  function creer() {
    setError(null);
    startTransition(async () => {
      const res = await createFicheRegroupee(semiFiniId, [...choisis]);
      if ("error" in res && res.error) setError(res.error);
      else if ("id" in res) {
        toast.success(`Ordre de coupe regroupé ${res.numeroOt} créé`);
        onOpenChange(false);
        router.push(`/atelier/patronnage/${res.id}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nouvel ordre de coupe regroupé" size="lg">
      <div className="space-y-4">
        <p className="text-xs text-foreground-muted">
          Une pièce (semi-fini) coupée pour plusieurs articles d&apos;ODF, quels que soient leur couleur et leur grammage : chaque couche du matelas
          appartient à un article. Un article coupé par pièces l&apos;est entièrement (toutes ses pièces par des ordres regroupés).
        </p>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          Semi-fini
          <select
            value={semiFiniId}
            onChange={(e) => {
              setSemiFiniId(e.target.value);
              setBesoins(null);
              setError(null);
            }}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">— Choisir —</option>
            {semiFinis.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ` : ""}
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {semiFinis.length === 0 && <p className="text-xs text-warning">Aucun semi-fini : créez-les dans Articles (nature « Semi-fini »).</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
        {semiFiniId && besoins === null && !error && <p className="text-xs text-foreground-muted">Recherche des articles…</p>}
        {besoins && besoins.length === 0 && (
          <p className="text-xs text-foreground-muted">Aucun article d&apos;ODF ouvert n&apos;a ce semi-fini dans sa nomenclature.</p>
        )}
        {besoins && besoins.length > 0 && (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {besoins.map((b) => (
              <li key={b.lineId} className="flex items-start gap-2 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={b.dejaEntier}
                  checked={choisis.has(b.lineId)}
                  onChange={(e) =>
                    setChoisis((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(b.lineId);
                      else n.delete(b.lineId);
                      return n;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{b.odf}</span> · {b.client} · {b.article}
                  {b.couleur ? ` · ${b.couleur}` : ""}
                  <span className="block text-xs text-foreground-muted">Reste à couper : {resteTexte(b) || "—"}</span>
                  {b.dejaEntier && <span className="block text-xs text-warning">Déjà coupé ou validé en t-shirts entiers : ne peut pas être regroupé.</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button loading={pending} disabled={!semiFiniId || choisis.size === 0} onClick={creer}>
            <Layers className="h-3.5 w-3.5" /> Créer l&apos;ordre regroupé
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Articles d'un ordre regroupé : reste à couper par taille, ajout et retrait. */
export function ArticlesRegroupesCard({ fiche, canModify }: { fiche: FichePlacement; canModify: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [besoins, setBesoins] = useState<BesoinSemiFini[] | null>(null);
  const [ajout, setAjout] = useState("");
  const semiFiniId = fiche.semiFini?.id ?? "";
  const regroupees = new Set(fiche.lignesRegroupees.map((l) => l.lineId));

  useEffect(() => {
    if (!semiFiniId) return;
    let annule = false;
    besoinsSemiFini(semiFiniId).then((res) => {
      if (!annule && !("error" in res)) setBesoins(res);
    });
    return () => {
      annule = true;
    };
  }, [semiFiniId, fiche.lignesRegroupees.length, fiche.traces.length]);

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

  const candidats = (besoins ?? []).filter((b) => !regroupees.has(b.lineId) && !b.dejaEntier);

  return (
    <Card>
      <CardHeader
        title={`Articles regroupés — ${fiche.semiFini?.name ?? ""}`}
        description="Chaque article reçoit les pièces des couches qui lui sont attribuées dans les tracés. Reste = demandé × quantité de la nomenclature − coupé − prévu (tracés validés)."
      />
      <CardBody className="space-y-3">
        {fiche.lignesRegroupees.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun article.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {fiche.lignesRegroupees.map((l) => {
              const b = besoins?.find((x) => x.lineId === l.lineId);
              return (
                <li key={l.lineId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{l.odfReference ?? "—"}</span> · {l.description}
                    {b?.couleur ? ` · ${b.couleur}` : ""}
                    {b && <span className="block text-xs text-foreground-muted">Reste à couper : {resteTexte(b) || "—"}</span>}
                  </span>
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
                </li>
              );
            })}
          </ul>
        )}
        {canModify && candidats.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={ajout} onChange={(e) => setAjout(e.target.value)} className="h-9 min-w-64 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="">Ajouter un article d&apos;ODF…</option>
              {candidats.map((b) => (
                <option key={b.lineId} value={b.lineId}>
                  {b.odf} · {b.article}
                  {b.couleur ? ` · ${b.couleur}` : ""} — reste {resteTexte(b)}
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
        {fiche.lignesRegroupees.map((l) => (
          <li key={l.lineId} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {l.odfReference ?? "—"} · {l.description}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={valeurs[l.lineId] ?? ""}
              disabled={!editable}
              onChange={(e) => setValeurs((v) => ({ ...v, [l.lineId]: e.target.value }))}
              className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-right text-sm disabled:opacity-60"
              aria-label={`Couches pour ${l.description}`}
            />
          </li>
        ))}
      </ul>
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
