"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { creerNomenclature, definirNomenclaturePrincipale, modifierNomenclature, supprimerNomenclature } from "../../actions";
import { NomenclatureEditor } from "./nomenclature-editor";

export interface NomenclatureOption {
  id: string;
  nom: string;
  forme: "ouvert" | "tubulaire";
  principale: boolean;
}

type EditorProps = Omit<Parameters<typeof NomenclatureEditor>[0], "nomenclatureId">;

export const FORME_LABELS: Record<NomenclatureOption["forme"], string> = { ouvert: "Tissu ouvert", tubulaire: "Tissu tubulaire" };
const champ = "h-9 w-full rounded-md border border-border bg-surface px-2 text-base sm:text-sm";

/**
 * Nomenclatures d'un produit fini (0161) : un même article peut se fabriquer de
 * plusieurs façons, par exemple en tissu ouvert (corps avant + corps arrière)
 * ou en tissu tubulaire (corps d'une seule pièce). La principale sert par
 * défaut sur les ODF ; les autres se choisissent par taille sur la ligne d'ODF.
 */
export function NomenclaturesPanel({ nomenclatures, lines, ...editor }: EditorProps & { nomenclatures: NomenclatureOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choisie, setChoisie] = useState<string | null>(null);
  const [fenetre, setFenetre] = useState<"nouvelle" | "modifier" | null>(null);
  const courante = nomenclatures.find((n) => n.id === choisie) ?? nomenclatures.find((n) => n.principale) ?? null;

  function run(fn: () => Promise<{ error?: string }>, succes: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(succes);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {nomenclatures.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setChoisie(n.id)}
            className={`min-h-9 rounded-md border px-3 text-sm font-medium ${courante?.id === n.id ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface"}`}
          >
            {n.nom} <span className="text-xs font-normal">· {n.forme}</span>
            {n.principale && <Star className="ml-1 inline h-3 w-3 fill-current" aria-label="Principale" />}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setFenetre("nouvelle")}>
          <Plus className="h-3.5 w-3.5" /> Nouvelle nomenclature
        </Button>
      </div>

      {courante && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-foreground-muted">
            {FORME_LABELS[courante.forme]}
            {courante.principale ? " · utilisée par défaut sur les ODF" : ""}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setFenetre("modifier")}>
            <Pencil className="h-3.5 w-3.5" /> Modifier
          </Button>
          {!courante.principale && (
            <>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => definirNomenclaturePrincipale(courante.id), `${courante.nom} est la nomenclature principale`)}>
                <Star className="h-3.5 w-3.5" /> Définir comme principale
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => supprimerNomenclature(courante.id), `${courante.nom} supprimée`)}>
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </Button>
            </>
          )}
        </div>
      )}

      <NomenclatureEditor key={courante?.id ?? "aucune"} nomenclatureId={courante?.id ?? null} lines={courante ? lines.filter((l) => l.nomenclature_id === courante.id) : lines} {...editor} />

      {fenetre && (
        <NomenclatureDialog
          productModelId={editor.productModelId}
          courante={courante}
          mode={fenetre}
          nomenclatures={nomenclatures}
          onClose={() => setFenetre(null)}
          onCreated={(id) => {
            setChoisie(id);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function NomenclatureDialog({
  productModelId,
  courante,
  mode,
  nomenclatures,
  onClose,
  onCreated,
}: {
  productModelId: string;
  courante: NomenclatureOption | null;
  mode: "nouvelle" | "modifier";
  nomenclatures: NomenclatureOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nom, setNom] = useState(mode === "modifier" ? (courante?.nom ?? "") : "");
  const [forme, setForme] = useState<NomenclatureOption["forme"]>(mode === "modifier" ? (courante?.forme ?? "ouvert") : "tubulaire");
  const [copie, setCopie] = useState(mode === "nouvelle" ? (courante?.id ?? "") : "");

  function enregistrer() {
    startTransition(async () => {
      if (mode === "modifier" && courante) {
        const res = await modifierNomenclature(courante.id, { nom, forme });
        if (res.error) {
          toast.error("Enregistrement refusé", { description: res.error });
          return;
        }
        router.refresh();
      } else {
        const res = await creerNomenclature(productModelId, { nom, forme }, copie || null);
        if (res.error || !res.id) {
          toast.error("Création refusée", { description: res.error });
          return;
        }
        onCreated(res.id);
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={mode === "modifier" ? "Modifier la nomenclature" : "Nouvelle nomenclature"} size="sm">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Nom</span>
          <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={60} placeholder="Tubulaire" className={champ} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Forme du tissu</span>
          <select value={forme} onChange={(e) => setForme(e.target.value as NomenclatureOption["forme"])} className={champ}>
            <option value="ouvert">{FORME_LABELS.ouvert}</option>
            <option value="tubulaire">{FORME_LABELS.tubulaire}</option>
          </select>
        </label>
        {mode === "nouvelle" && nomenclatures.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Lignes de départ</span>
            <select value={copie} onChange={(e) => setCopie(e.target.value)} className={champ}>
              <option value="">Nomenclature vide</option>
              {nomenclatures.map((n) => (
                <option key={n.id} value={n.id}>
                  Copier {n.nom}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button className="w-full sm:w-auto" loading={pending} disabled={!nom.trim()} onClick={enregistrer}>
            Enregistrer
          </Button>
          <Button variant="ghost" className="w-full sm:w-auto" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
