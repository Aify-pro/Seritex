"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "./form-kit";

/** Export pour l'IA (D6) : période et format ; le fichier se télécharge. */
export function ExportDialog() {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("md");
  // Période par défaut : les 30 derniers jours (calculée une fois, à l'ouverture de la page).
  const [{ today, monthAgo }] = useState(() => {
    const now = new Date();
    return { today: now.toISOString().slice(0, 10), monthAgo: new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10) };
  });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Download className="h-3.5 w-3.5" /> Exporter pour l&apos;IA
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Exporter le suivi des véhicules"
        description="Un fichier à confier à une IA pour qu'elle en tire un rapport : consommation, écarts compteur/GPS, alertes, papiers, entretien, sinistres."
        size="sm"
      >
        <form method="get" action="/api/vehicules/export" onSubmit={() => setTimeout(() => setOpen(false), 300)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Du">
              <input type="date" name="du" defaultValue={monthAgo} max={today} className={inputClass} />
            </Field>
            <Field label="Au">
              <input type="date" name="au" defaultValue={today} max={today} className={inputClass} />
            </Field>
          </div>
          <Field label="Format">
            <select name="format" value={format} onChange={(e) => setFormat(e.target.value)} className={inputClass}>
              <option value="md">Rapport complet (Markdown)</option>
              <option value="txt">Rapport complet (texte)</option>
              <option value="csv">Tableau CSV (Excel)</option>
            </select>
          </Field>
          {format === "csv" && (
            <Field label="Données">
              <select name="jeu" defaultValue="synthese" className={inputClass}>
                <option value="synthese">Synthèse par véhicule</option>
                <option value="bons">Bons de carburant et contrôles</option>
                <option value="km_jours">Km GPS par jour</option>
                <option value="alertes">Alertes GPS</option>
              </select>
            </Field>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              <Download className="h-3.5 w-3.5" /> Télécharger
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
