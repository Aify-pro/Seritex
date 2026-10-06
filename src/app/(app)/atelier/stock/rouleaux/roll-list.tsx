"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { issueRoll, returnRoll, scrapRoll } from "./actions";

export interface RollRow {
  code: string;
  textileId: string;
  tissu: string;
  articleId: string | null;
  coloris: string | null;
  bain: string | null;
  numeroFournisseur: string | null;
  laizeCm: number | null;
  poidsKg: number;
  poidsInitialKg: number;
  statut: "en_stock" | "en_production" | "epuise" | "rebut";
  odf: { id: string; reference: string } | null;
  emplacement: string | null;
}

export const ROLL_STATUT_LABELS: Record<RollRow["statut"], string> = {
  en_stock: "En stock",
  en_production: "En production",
  epuise: "Épuisé",
  rebut: "Rebut",
};
const TONE: Record<RollRow["statut"], "success" | "info" | "neutral" | "danger"> = {
  en_stock: "success",
  en_production: "info",
  epuise: "neutral",
  rebut: "danger",
};

const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm";
const kg = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`;

/** Rouleaux en stock et en production, avec leurs actions (sortie vers un ODF, retour pesé, rebut, étiquette). */
type OdfOption = { id: string; label: string; textileIds: string[] };

export function RollList({ rows, odfs, canAct }: { rows: RollRow[]; odfs: OdfOption[]; canAct: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <p className="px-5 py-6 text-sm text-foreground-muted">Aucun rouleau ne correspond.</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.code} className="px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-mono text-xs font-medium">{r.code}</span>
            <span>
              {r.articleId ? (
                <Link href={`/articles/${r.articleId}/general`} className="hover:underline">
                  {r.tissu}
                </Link>
              ) : (
                r.tissu
              )}
              {r.coloris && <span className="text-foreground-muted"> · {r.coloris}</span>}
            </span>
            <span className="text-xs text-foreground-muted">Bain {r.bain ?? "—"}</span>
            <span className="tabular-nums">{r.laizeCm ? `${r.laizeCm} cm` : "laize —"}</span>
            <span className="tabular-nums">
              {kg(r.poidsKg)}
              {r.poidsKg !== r.poidsInitialKg && <span className="text-xs text-foreground-muted"> / {kg(r.poidsInitialKg)}</span>}
            </span>
            <Badge tone={TONE[r.statut]}>{ROLL_STATUT_LABELS[r.statut]}</Badge>
            {r.odf && (
              <Link href={`/atelier/production/${r.odf.id}?onglet=stock`} className="text-xs text-brand hover:underline">
                {r.odf.reference}
              </Link>
            )}
            {r.emplacement && <span className="text-xs text-foreground-muted">{r.emplacement}</span>}
            {r.numeroFournisseur && <span className="text-xs text-foreground-muted">n° {r.numeroFournisseur}</span>}
            <span className="ml-auto flex items-center gap-2">
              <a href={`/api/stock/rouleaux/etiquettes?codes=${r.code}`} target="_blank" rel="noreferrer" aria-label="Étiquette" className="text-foreground-muted hover:text-foreground">
                <Printer className="h-4 w-4" />
              </a>
              {canAct && (r.statut === "en_stock" || r.statut === "en_production") && (
                <Button size="sm" variant="secondary" onClick={() => setOpen(open === r.code ? null : r.code)}>
                  {r.statut === "en_stock" ? "Sortir / rebut" : "Retour au stock"}
                </Button>
              )}
            </span>
          </div>
          {open === r.code && <RollActions roll={r} odfs={odfs} onDone={() => setOpen(null)} />}
        </li>
      ))}
    </ul>
  );
}

function RollActions({ roll, odfs, onDone }: { roll: RollRow; odfs: OdfOption[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Les ODF qui coupent ce tissu d'abord : c'est à eux que le rouleau est destiné.
  const memeTissu = odfs.filter((o) => o.textileIds.includes(roll.textileId));
  const autres = odfs.filter((o) => !o.textileIds.includes(roll.textileId));
  const [odf, setOdf] = useState((memeTissu[0] ?? autres[0])?.id ?? "");
  const [poids, setPoids] = useState("");
  const [motif, setMotif] = useState("");
  const run = (fn: () => Promise<{ error?: string; consomme?: number }>, ok: (r: { consomme?: number }) => string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(ok(res));
        onDone();
        router.refresh();
      }
    });

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted/50 p-3">
      {roll.statut === "en_stock" ? (
        <>
          <label className="text-xs">
            <span className="mb-1 block text-foreground-muted">Coupe pour l&apos;ODF</span>
            <select value={odf} onChange={(e) => setOdf(e.target.value)} className={`${input} w-72`}>
              {memeTissu.length > 0 && (
                <optgroup label={`ODF qui coupent ${roll.tissu}`}>
                  {memeTissu.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {autres.length > 0 && (
                <optgroup label="Autres ODF">
                  {autres.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-foreground-muted">Motif (si autre bain, ou rebut)</span>
            <input value={motif} onChange={(e) => setMotif(e.target.value)} className={`${input} w-64`} />
          </label>
          <Button size="sm" loading={pending} disabled={!odf} onClick={() => run(() => issueRoll(roll.code, odf, motif), () => `${roll.code} sorti vers l'ODF`)}>
            Sortir pour la coupe
          </Button>
          <Button size="sm" variant="ghost" loading={pending} disabled={!motif.trim()} onClick={() => run(() => scrapRoll(roll.code, motif), () => `${roll.code} mis au rebut`)}>
            Mettre au rebut
          </Button>
        </>
      ) : (
        <>
          <label className="text-xs">
            <span className="mb-1 block text-foreground-muted">Poids restant pesé (kg, 0 si vide)</span>
            <input value={poids} inputMode="decimal" onChange={(e) => setPoids(e.target.value)} className={`${input} w-40`} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-foreground-muted">Motif (si plus lourd qu&apos;au départ)</span>
            <input value={motif} onChange={(e) => setMotif(e.target.value)} className={`${input} w-64`} />
          </label>
          <Button
            size="sm"
            loading={pending}
            disabled={poids.trim() === ""}
            onClick={() =>
              run(
                () => returnRoll(roll.code, Number(poids.replace(",", ".")), motif),
                (r) => `${roll.code} revenu au stock — ${kg(r.consomme ?? 0)} consommés`
              )
            }
          >
            Enregistrer le retour
          </Button>
        </>
      )}
    </div>
  );
}
