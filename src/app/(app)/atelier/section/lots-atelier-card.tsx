import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export interface LotAtelierRow {
  lot_id: string;
  code: string;
  categorie: string;
  odf: string;
  article: string | null;
  composition_taille: Record<string, number>;
  en_transit: boolean;
  depuis: string;
  verrouille: boolean;
}

/**
 * Stock tampon de l'atelier (étape 4a, migration 0151, S25) : lots détenus
 * par la section (dernier scan d'entrée, ou créés ici et jamais scannés), et
 * lots partis d'ici pas encore reçus ailleurs (en transit). Consultation.
 */
export function LotsAtelierCard({ lots }: { lots: LotAtelierRow[] }) {
  if (lots.length === 0) return null;
  const ici = lots.filter((l) => !l.en_transit);
  const transit = lots.filter((l) => l.en_transit);
  const tailles = (c: Record<string, number>) =>
    Object.entries(c ?? {})
      .filter(([, n]) => Number(n) > 0)
      .map(([t, n]) => `${n} ${t.split("/").pop()}`)
      .join(", ");
  const ligne = (l: LotAtelierRow) => (
    <li key={l.lot_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
      <span>
        <span className="font-mono text-xs">{l.code}</span> · {l.odf}
        {l.article ? ` · ${l.article}` : ""} · {tailles(l.composition_taille)}
        {l.verrouille && <span className="ml-1.5 rounded-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">verrouillé</span>}
      </span>
      <span className="text-xs text-foreground-muted">depuis le {formatDateTime(l.depuis)}</span>
    </li>
  );
  return (
    <Card>
      <CardHeader
        title={`Lots dans l'atelier (${ici.length})`}
        description="Stock tampon de la section : lots reçus ici (dernier scan d'entrée) ou créés ici et pas encore partis. Un lot passe à l'atelier suivant quand celui-ci scanne son entrée."
      />
      <CardBody className="p-0">
        <ul className="divide-y divide-border">{ici.map(ligne)}</ul>
        {transit.length > 0 && (
          <>
            <p className="border-t border-border bg-surface-muted px-4 py-1.5 text-xs font-medium text-foreground-muted">
              Partis d&apos;ici, pas encore reçus ailleurs ({transit.length})
            </p>
            <ul className="divide-y divide-border">{transit.map(ligne)}</ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
