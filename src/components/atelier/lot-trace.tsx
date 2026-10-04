import Link from "next/link";
import { formatDateTime } from "@/lib/utils";

/** Résultat de article_lot_trace() (migration 0086). */
export interface LotTrace {
  lot: { id: string; code: string; categorie: string; statut: string; composition: Record<string, number>; etape_courante: number | null };
  odf: { id: string; reference: string } | null;
  article: string | null;
  origines: {
    code: string;
    profondeur: number;
    categorie: string;
    statut: string;
    trace: string | null;
    matelas:
      | { le: string; resultat: string | null; quantites: Record<string, number> | null; couches: number | null; longueur_cm: number | null; laize_cm: number | null; poids_tissu_kg: number | null }[]
      | null;
  }[];
  parcours: { le: string; lot: string; type: string; etape: number | null; section: string | null; detail: Record<string, unknown>; par: string | null }[];
  expeditions: { id: string; reference: string | null; statut: string }[];
}

const EVENT_LABELS: Record<string, string> = {
  entree_section: "Entrée",
  sortie_section: "Sortie",
  declaration: "Déclaration",
  decoupage: "Découpage",
  regroupement: "Regroupement",
  mise_en_colis: "Mise en colis",
};

const STATUT_LABELS: Record<string, string> = {
  en_cours: "en atelier",
  termine: "terminé",
  expedie: "expédié",
  eclate: "découpé",
  regroupe: "regroupé",
};

const short = (cle: string) => cle.split("/").pop() ?? cle;

/**
 * Traçabilité d'un lot (SF-5) : ses origines (lot découpé, lots regroupés,
 * jusqu'au lot de coupe et son matelas), puis toutes les sections traversées.
 */
export function LotTraceView({ trace, linkLots = true }: { trace: LotTrace; linkLots?: boolean }) {
  const lotLink = (code: string) =>
    linkLots ? (
      <Link href={`/lots/${code}`} className="font-mono text-xs font-medium text-brand hover:underline">
        {code}
      </Link>
    ) : (
      <span className="font-mono text-xs">{code}</span>
    );
  const matelas = trace.origines.filter((o) => o.trace);
  return (
    <div className="space-y-4 text-sm">
      <p>
        {lotLink(trace.lot.code)} · {trace.article ?? "Article"} · {STATUT_LABELS[trace.lot.statut] ?? trace.lot.statut} ·{" "}
        {Object.entries(trace.lot.composition ?? {})
          .map(([t, q]) => `${short(t)} ${q}`)
          .join(", ") || "—"}
        {trace.odf && (
          <>
            {" "}
            · ODF{" "}
            <Link href={`/atelier/production/${trace.odf.id}`} className="text-brand hover:underline">
              {trace.odf.reference}
            </Link>
          </>
        )}
      </p>

      {trace.origines.some((o) => o.profondeur > 0) && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground-muted">Origines</p>
          <ul className="space-y-0.5">
            {trace.origines
              .filter((o) => o.profondeur > 0)
              .map((o) => (
                <li key={o.code} style={{ paddingLeft: `${(o.profondeur - 1) * 12}px` }}>
                  {lotLink(o.code)} <span className="text-xs text-foreground-muted">({STATUT_LABELS[o.statut] ?? o.statut})</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground-muted">Coupe et matelas</p>
        {matelas.length === 0 ? (
          <p className="text-xs text-foreground-muted">Aucun lot de coupe rattaché à un tracé.</p>
        ) : (
          <ul className="space-y-1">
            {matelas.map((o) => (
              <li key={o.code}>
                {lotLink(o.code)} · tracé <span className="font-mono text-xs">{o.trace}</span>
                {(o.matelas ?? []).map((m, i) => (
                  <p key={i} className="text-xs text-foreground-muted">
                    Matelas clôturé le {formatDateTime(m.le)} · {m.couches ?? "?"} couches · {m.longueur_cm ?? "?"} cm × {m.laize_cm ?? "?"} cm ·{" "}
                    {m.poids_tissu_kg ?? "?"} kg de tissu {m.resultat === "probleme" ? "· problème signalé" : ""}
                  </p>
                ))}
                {(o.matelas ?? []).length === 0 && <p className="text-xs text-foreground-muted">Matelas pas encore clôturé.</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground-muted">Parcours</p>
        {trace.parcours.length === 0 ? (
          <p className="text-xs text-foreground-muted">Aucun scan ni déclaration rattaché à ce lot.</p>
        ) : (
          <ul className="divide-y divide-border">
            {trace.parcours.map((p, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-1 text-xs">
                <span>
                  {EVENT_LABELS[p.type] ?? p.type}
                  {p.section ? ` · ${p.section}` : ""}
                  {p.etape ? ` (étape ${p.etape})` : ""}
                  {p.type === "declaration" && p.detail
                    ? ` · ${String(p.detail.quantite ?? "")} ${String(p.detail.type ?? "").replace("_", " ")} ${short(String(p.detail.taille ?? ""))}`
                    : ""}
                  {p.lot !== trace.lot.code ? ` · lot ${p.lot}` : ""}
                </span>
                <span className="text-foreground-muted">
                  {formatDateTime(p.le)}
                  {p.par ? ` · ${p.par}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {trace.expeditions.length > 0 && (
        <p className="text-xs">
          Expédié :{" "}
          {trace.expeditions.map((e) => (
            <Link key={e.id} href={`/livraisons/${e.id}`} className="mr-2 text-brand hover:underline">
              {e.reference ?? "expédition"}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}
