"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { grilleProposee, type ParametresSerigraphie } from "@/lib/separation/prix-revient";
import { appliquerGrilleSerigraphie, saveSerigraphieParametres } from "./actions";

const num = (v: string) => Number(String(v).replace(",", "."));
const f = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} F`;

type Champ = { cle: keyof ParametresSerigraphie; label: string; aide: string; facultatif?: boolean };

const CHAMPS: Champ[] = [
  { cle: "coutEcran", label: "Coût d'un écran (F)", aide: "Film, émulsion, insolation, récupération." },
  { cle: "calageMin", label: "Calage par écran (min)", aide: "Mise en place et réglage sur la machine." },
  { cle: "tauxHoraire", label: "Taux horaire (F/h)", aide: "Équipe d'impression, charges comprises." },
  { cle: "impressionS", label: "Impression (s/pièce/écran)", aide: "Temps pour passer une couleur sur une pièce." },
  { cle: "sechagePiece", label: "Séchage (F/pièce/passage)", aide: "Flash ou tunnel : énergie et usure." },
  { cle: "gachePct", label: "Gâche (%)", aide: "Pièces ratées en plus des pièces bonnes." },
  { cle: "depotGm2", label: "Dépôt d'encre (g/m²)", aide: "Par défaut ; une encre peut avoir le sien." },
  { cle: "perteEncrePct", label: "Pertes d'encre (%)", aide: "Restée dans l'écran, nettoyage." },
  { cle: "prixEncreKg", label: "Prix d'encre par défaut (F/kg)", aide: "Pour une encre sans prix d'achat.", facultatif: true },
  { cle: "surfaceRefCm2", label: "Surface par couleur (cm²)", aide: "Référence de la grille proposée." },
  { cle: "quantiteRef", label: "Quantité de référence", aide: "Référence de la grille proposée." },
];

const VERS_COLONNE: Record<keyof ParametresSerigraphie, string> = {
  coutEcran: "cout_ecran",
  calageMin: "calage_min",
  tauxHoraire: "taux_horaire",
  impressionS: "impression_s",
  sechagePiece: "sechage_piece",
  gachePct: "gache_pct",
  depotGm2: "depot_g_m2",
  perteEncrePct: "perte_encre_pct",
  prixEncreKg: "prix_encre_kg",
  surfaceRefCm2: "surface_ref_cm2",
  quantiteRef: "quantite_ref",
};

/**
 * Prix de revient de la sérigraphie (migration 0117) : paramètres de
 * l'atelier, grille « coût d'impression par nombre de couleurs » qu'ils
 * donnent, comparée à la grille actuelle, et report après validation.
 */
export function SerigraphieForm({
  initial,
  grilleActuelle,
  fraisEcranActuel,
}: {
  initial: ParametresSerigraphie;
  grilleActuelle: Record<number, number>;
  fraisEcranActuel: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<Record<string, string>>(
    Object.fromEntries(CHAMPS.map((c) => [c.cle, initial[c.cle] == null ? "" : String(initial[c.cle])]))
  );
  const saisis = useMemo<ParametresSerigraphie>(
    () =>
      Object.fromEntries(
        CHAMPS.map((c) => [c.cle, v[c.cle].trim() === "" ? (c.facultatif ? null : 0) : num(v[c.cle])])
      ) as ParametresSerigraphie,
    [v]
  );
  const modifie = CHAMPS.some((c) => (initial[c.cle] == null ? "" : String(initial[c.cle])) !== v[c.cle].trim());
  const valide = CHAMPS.every((c) => (c.facultatif && v[c.cle].trim() === "") || Number.isFinite(num(v[c.cle])));
  const grille = useMemo(() => (valide ? grilleProposee(saisis) : null), [saisis, valide]);

  function enregistrer() {
    startTransition(async () => {
      const payload = Object.fromEntries(CHAMPS.map((c) => [VERS_COLONNE[c.cle], saisis[c.cle]]));
      const res = await saveSerigraphieParametres(payload as Parameters<typeof saveSerigraphieParametres>[0]);
      if (res.error) toast.error("Paramètres non enregistrés", { description: res.error });
      else {
        toast.success("Paramètres de sérigraphie enregistrés");
        router.refresh();
      }
    });
  }

  function reporter() {
    startTransition(async () => {
      const res = await appliquerGrilleSerigraphie();
      if (res.error) toast.error("Grille non reportée", { description: res.error });
      else {
        toast.success("Grille impression et frais d'écran mis à jour");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CHAMPS.map((c) => (
          <label key={c.cle} className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">{c.label}</span>
            <input
              inputMode="decimal"
              value={v[c.cle]}
              placeholder={c.facultatif ? "—" : undefined}
              disabled={pending}
              onChange={(e) => setV({ ...v, [c.cle]: e.target.value })}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            />
            <span className="mt-0.5 block text-[11px] text-foreground-muted">{c.aide}</span>
          </label>
        ))}
      </div>
      <Button size="sm" loading={pending} disabled={!modifie || !valide} onClick={enregistrer}>
        Enregistrer les paramètres
      </Button>

      {grille && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Grille proposée par ces paramètres</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-left text-foreground-muted">
                <tr>
                  <th className="py-1 font-medium">Couleurs</th>
                  <th className="py-1 text-right font-medium">Coût par pièce proposé</th>
                  <th className="py-1 text-right font-medium">Grille actuelle</th>
                  <th className="py-1 text-right font-medium">Revient / pièce à {saisis.quantiteRef} pièces</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grille.lignes.map((l) => (
                  <tr key={l.nbCouleurs}>
                    <td className="py-1.5">{l.nbCouleurs}</td>
                    <td className="py-1.5 text-right font-medium">{f(l.coutPiece)}</td>
                    <td className="py-1.5 text-right text-foreground-muted">{grilleActuelle[l.nbCouleurs] != null ? f(grilleActuelle[l.nbCouleurs]) : "—"}</td>
                    <td className="py-1.5 text-right">{f(l.parPieceRef)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1.5">Frais par écran</td>
                  <td className="py-1.5 text-right font-medium">{f(grille.fraisEcran)}</td>
                  <td className="py-1.5 text-right text-foreground-muted">{f(fraisEcranActuel)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-foreground-muted">
            Chaque couleur couvre {saisis.surfaceRefCm2.toLocaleString("fr-FR")} cm². Le coût par pièce comprend l&apos;encre, l&apos;impression, le séchage et la
            gâche ; les frais par écran (écran et calage) sont amortis sur la quantité du devis, comme aujourd&apos;hui.
          </p>
          <Button size="sm" variant="secondary" loading={pending} disabled={modifie} onClick={reporter}>
            Reporter dans la grille impression
          </Button>
          {modifie && <p className="text-xs text-warning">Enregistrez d&apos;abord les paramètres : le report part des paramètres enregistrés.</p>}
        </div>
      )}
    </div>
  );
}
