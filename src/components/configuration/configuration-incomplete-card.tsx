import { AlertTriangle } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export interface AnomalieConfiguration {
  article: string;
  anomalie: string;
}

/**
 * Ce qui manque à la configuration des articles d'un devis ou d'un ODF
 * (migration 0166) : même règle que le garde-fou de la base, qui bloque l'envoi
 * du devis, son acceptation et la soumission de l'ODF. Rien ne s'affiche quand
 * tout est complet.
 */
export function ConfigurationIncompleteCard({ anomalies, bloque }: { anomalies: AnomalieConfiguration[]; bloque: string }) {
  if (anomalies.length === 0) return null;
  const parArticle = new Map<string, string[]>();
  for (const a of anomalies) parArticle.set(a.article, [...(parArticle.get(a.article) ?? []), a.anomalie]);
  return (
    <Card className="border-warning/40">
      <CardHeader title="Configuration à compléter" description={`Tant que ces points restent ouverts, ${bloque}.`} />
      <CardBody className="space-y-3">
        {[...parArticle.entries()].map(([article, liste]) => (
          <div key={article} className="space-y-1">
            <p className="text-sm font-medium text-foreground">{article}</p>
            <ul className="space-y-1">
              {liste.map((a) => (
                <li key={a} className="flex items-start gap-1.5 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
