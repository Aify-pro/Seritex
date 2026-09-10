"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { recordPesee } from "../../section/actions";

type ArticleLotOption = { id: string; code: string; categorie: string };
type StockItemOption = { sageReference: string; designation: string };

const PESEE_TYPE_LABELS = {
  reception_tissu: "Réception tissu",
  sortie_lot: "Sortie lot article",
  retour_stock: "Retour stock",
} as const;

/**
 * Partie Stock de la fiche ODF, réservée au gestionnaire de stock (+
 * responsable_production/administrateur en override) — migrations 0022/0023.
 * Remonté en usage réel : la réception de marchandise ne doit pas être
 * saisie par la section Coupe, c'est le travail du gestionnaire de stock ;
 * cette partie lui donne un endroit dédié, sur l'ODF concerné, pour
 * enregistrer entrées et sorties — d'où se génèrent ensuite les mouvements
 * de stock et les fiches d'export Sage (carte « Mouvements de stock »
 * juste en dessous).
 */
export function StockEntryForm({
  productionOrderId,
  articleLots,
  stockItemOptions,
}: {
  productionOrderId: string;
  articleLots: ArticleLotOption[];
  stockItemOptions: StockItemOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<keyof typeof PESEE_TYPE_LABELS>("reception_tissu");
  const [lotId, setLotId] = useState("");
  const [poidsKg, setPoidsKg] = useState("");
  const [articleRef, setArticleRef] = useState("");

  function submit() {
    setError(null);
    if (poidsKg.trim() === "" || Number(poidsKg) <= 0) {
      setError("Poids invalide (kg, > 0).");
      return;
    }
    if (type === "sortie_lot" && !lotId) {
      setError("Choisissez le lot article pesé en sortie.");
      return;
    }
    startTransition(async () => {
      const res = await recordPesee(
        type,
        productionOrderId,
        Number(poidsKg),
        type === "sortie_lot" ? lotId : null,
        type !== "sortie_lot" ? articleRef || null : null
      );
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast.success(`Pesée enregistrée — ${PESEE_TYPE_LABELS[type].toLowerCase()}`);
      setPoidsKg("");
      setLotId("");
      setArticleRef("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Stock" description="Réceptions, sorties et retours de matière pour cet ordre de fabrication." />
      <CardBody className="space-y-2">
        {error && (
          <div className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className="block text-[10px] text-foreground-muted">Type</label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setLotId("");
              }}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            >
              {Object.entries(PESEE_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {type === "sortie_lot" ? (
            <div>
              <label className="block text-[10px] text-foreground-muted">Lot article</label>
              <select
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">— choisir —</option>
                {articleLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.code}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] text-foreground-muted">
                Article Sage <span className="normal-case text-foreground-muted">(optionnel)</span>
              </label>
              <select
                value={articleRef}
                onChange={(e) => setArticleRef(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">
                  {stockItemOptions.length === 0 ? "Aucun article synchronisé" : "— non renseigné —"}
                </option>
                {stockItemOptions.map((item) => (
                  <option key={item.sageReference} value={item.sageReference}>
                    {item.designation} ({item.sageReference})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-[10px] text-foreground-muted">Poids (kg)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={poidsKg}
              onChange={(e) => setPoidsKg(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={submit} loading={pending} className="w-full">
              Enregistrer
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
