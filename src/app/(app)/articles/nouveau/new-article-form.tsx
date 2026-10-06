"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import {
  NATURE_LABELS,
  TYPE_APPRO_HINTS,
  TYPE_APPRO_LABELS,
  UNITE_LABELS,
  type ArticleNature,
  type TypeAppro,
  type Unite,
} from "@/lib/articles/natures";
import { createArticle } from "../fiche-actions";

type Option = { id: string; nom: string };
const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-foreground-muted">{hint}</span>}
    </label>
  );
}

/** Valeurs par défaut selon la nature : un tissu se gère au kg et s'achète, un vêtement se fabrique. */
const DEFAUTS: Record<ArticleNature, { type: TypeAppro; unite: Unite }> = {
  pf: { type: "fabrique", unite: "piece" },
  mp: { type: "negoce", unite: "kg" },
  consommable: { type: "negoce", unite: "piece" },
};

/**
 * Fiche de création d'un article : identité et classement communs à toutes
 * les natures, puis les caractéristiques propres à la nature choisie.
 */
export function NewArticleForm({
  familles,
  categories,
  matieres,
  consumableFamilies,
}: {
  familles: (Option & { parentId: string | null })[];
  categories: Option[];
  matieres: Option[];
  consumableFamilies: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    nature: "pf" as ArticleNature,
    name: "",
    type_appro: "fabrique" as TypeAppro,
    famille_id: "",
    sous_famille_id: "",
    unite: "piece" as Unite,
    categorie_id: "",
    matiere_id: "",
    composition: "",
    grammage: "",
    consumable_family_id: consumableFamilies[0]?.id ?? "",
    etape: "production" as "production" | "finition",
    sage_reference: "",
  });
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const racines = familles.filter((f) => !f.parentId);
  const sousFamilles = familles.filter((f) => f.parentId && f.parentId === v.famille_id);

  function submit() {
    startTransition(async () => {
      const res = await createArticle(v);
      if (res.error) toast.error("Article non créé", { description: res.error });
      else {
        toast.success("Article créé");
        router.push(`/articles/${res.id}/general`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Identité et classement" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Nature">
            {(Object.keys(NATURE_LABELS) as ArticleNature[]).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={v.nature === n}
                onClick={() => set({ nature: n, type_appro: DEFAUTS[n].type, unite: DEFAUTS[n].unite })}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  v.nature === n ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-foreground hover:bg-surface-muted"
                }`}
              >
                {NATURE_LABELS[n]}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom">
              <input value={v.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder={v.nature === "mp" ? "Jersey 180 g" : v.nature === "consommable" ? "Bouton nacre 12 mm" : "T-shirt col rond"} />
            </Field>
            <Field label="Type" hint={TYPE_APPRO_HINTS[v.type_appro]}>
              <select value={v.type_appro} onChange={(e) => set({ type_appro: e.target.value as TypeAppro })} className={input}>
                {(Object.keys(TYPE_APPRO_LABELS) as TypeAppro[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_APPRO_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Famille" hint={racines.length === 0 ? "Aucune famille : créez-les dans Paramètres > Produits > Familles d'articles." : undefined}>
              <select value={v.famille_id} onChange={(e) => set({ famille_id: e.target.value, sous_famille_id: "" })} className={input}>
                <option value="">—</option>
                {racines.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sous-famille">
              <select value={v.sous_famille_id} onChange={(e) => set({ sous_famille_id: e.target.value })} disabled={sousFamilles.length === 0} className={input}>
                <option value="">—</option>
                {sousFamilles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unité de gestion et de vente">
              <select value={v.unite} onChange={(e) => set({ unite: e.target.value as Unite })} className={input}>
                {(Object.keys(UNITE_LABELS) as Unite[]).map((u) => (
                  <option key={u} value={u}>
                    {UNITE_LABELS[u]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </CardBody>
      </Card>

      {v.nature === "pf" && (
        <Card>
          <CardHeader title="Produit fini" description="Catégorie et matière servent au code du modèle. Tailles, couleurs, grammages et déclinaisons se renseignent ensuite dans la fiche." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Catégorie">
              <select value={v.categorie_id} onChange={(e) => set({ categorie_id: e.target.value })} className={input}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Matière">
              <select value={v.matiere_id} onChange={(e) => set({ matiere_id: e.target.value })} className={input}>
                <option value="">—</option>
                {matieres.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom}
                  </option>
                ))}
              </select>
            </Field>
          </CardBody>
        </Card>
      )}

      {v.nature === "mp" && (
        <Card>
          <CardHeader title="Matière première (tissu)" description="La laize et le poids se renseignent par rouleau, dans le stock." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Composition">
              <input value={v.composition} onChange={(e) => set({ composition: e.target.value })} className={input} placeholder="100 % coton" />
            </Field>
            <Field label="Matière">
              <select value={v.matiere_id} onChange={(e) => set({ matiere_id: e.target.value })} className={input}>
                <option value="">—</option>
                {matieres.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grammage nominal (g/m²)" hint="Le grammage réel d'un rouleau varie (ex. 175 à 185 pour 180) : il se mesure à la production.">
              <input value={v.grammage} onChange={(e) => set({ grammage: e.target.value })} inputMode="decimal" className={input} />
            </Field>
          </CardBody>
        </Card>
      )}

      {v.nature === "consommable" && (
        <Card>
          <CardHeader title="Consommable" description="Le code (ex. COBO0001) est attribué à la création selon le préfixe choisi, puis figé." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Préfixe du code">
              <select value={v.consumable_family_id} onChange={(e) => set({ consumable_family_id: e.target.value })} className={input}>
                {consumableFamilies.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Consommé en">
              <select value={v.etape} onChange={(e) => set({ etape: e.target.value as "production" | "finition" })} className={input}>
                <option value="production">Production</option>
                <option value="finition">Finition</option>
              </select>
            </Field>
            <Field label="Référence Sage">
              <input value={v.sage_reference} onChange={(e) => set({ sage_reference: e.target.value })} maxLength={18} className={`${input} font-mono`} />
            </Field>
          </CardBody>
        </Card>
      )}

      <div className="flex gap-2">
        <Button loading={pending} disabled={!v.name.trim()} onClick={submit}>
          Créer l&apos;article
        </Button>
        <Button variant="ghost" onClick={() => router.push("/articles")}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
