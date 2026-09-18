"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { setProductionOrderLineSections } from "../actions";

/**
 * Sections retenues pour UN article de l'ODF, dans l'ordre où le travail
 * doit passer (migration 0037 : par article, plus par ODF entier — une
 * commande peut mêler un article à imprimer et un autre non). Écriture
 * directe sur production_order_line_sections, autorisée par la RLS pour
 * responsable_production/administrateur.
 *
 * Auto-enregistré à chaque changement (ajout/retrait/réordonnancement), pas
 * de bouton "brouillon" séparé — `router.refresh()` ensuite pour que la
 * fiche Patronnage / le visuel apparaissent immédiatement si une section
 * Coupe/Impression vient d'être ajoutée, sans naviguer.
 *
 * Chaque section porte sa quantité de pièces (migration 0052, vide = toute
 * la quantité de l'article). Quand plusieurs ateliers d'une même catégorie
 * sont retenus, un avertissement s'affiche sous la liste tant que leur
 * total ne correspond pas à la quantité de l'article : soit le travail est
 * partagé et il faut répartir les pièces, soit une section est de trop.
 * Avertissement seulement, pas un blocage de validation.
 */
type ChosenSection = { sectionId: string; quantite: number | null };

export function LineSectionsPicker({
  lineId,
  productionOrderId,
  allSections,
  lineQuantity,
  initialSections,
}: {
  lineId: string;
  productionOrderId: string;
  allSections: { id: string; name: string; categorieNom: string | null }[];
  lineQuantity: number;
  initialSections: ChosenSection[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sections, setSections] = useState<ChosenSection[]>(initialSections);

  const sectionIds = sections.map((s) => s.sectionId);
  const availableSections = allSections.filter((s) => !sectionIds.includes(s.id));
  const quantiteEffective = (s: ChosenSection) => s.quantite ?? lineQuantity;

  // Catégories où plusieurs ateliers sont retenus et dont le total ne
  // correspond pas à la quantité de l'article.
  const byCategorie = new Map<string, ChosenSection[]>();
  for (const s of sections) {
    const categorie = allSections.find((a) => a.id === s.sectionId)?.categorieNom;
    if (categorie) byCategorie.set(categorie, [...(byCategorie.get(categorie) ?? []), s]);
  }
  const ecarts = [...byCategorie.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([categorie, group]) => ({
      categorie,
      group,
      total: group.reduce((somme, s) => somme + quantiteEffective(s), 0),
    }))
    .filter((e) => e.total !== lineQuantity);

  function persist(next: ChosenSection[]) {
    setSections(next);
    startTransition(async () => {
      const res = await setProductionOrderLineSections(lineId, productionOrderId, next);
      if (res.error) {
        toast.error("Sections non enregistrées", { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  function addSection(id: string) {
    persist([...sections, { sectionId: id, quantite: null }]);
  }

  function removeSection(id: string) {
    persist(sections.filter((s) => s.sectionId !== id));
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  }

  function setQuantite(id: string, raw: string) {
    const trimmed = raw.trim();
    const quantite = trimmed === "" ? null : Number(trimmed);
    if (quantite !== null && (!Number.isInteger(quantite) || quantite < 0)) {
      toast.error("Quantité invalide", { description: "Saisissez un nombre entier de pièces." });
      return;
    }
    const current = sections.find((s) => s.sectionId === id);
    if (!current || current.quantite === quantite) return;
    persist(sections.map((s) => (s.sectionId === id ? { ...s, quantite } : s)));
  }

  // Partage à parts égales entre les ateliers d'une catégorie ; le reste de
  // la division va aux premiers dans l'ordre de passage (ex. 101 → 51 / 50).
  function repartirEgalement(group: ChosenSection[]) {
    const ids = group.map((s) => s.sectionId);
    const base = Math.floor(lineQuantity / ids.length);
    const reste = lineQuantity % ids.length;
    persist(
      sections.map((s) => {
        const rang = ids.indexOf(s.sectionId);
        return rang === -1 ? s : { ...s, quantite: base + (rang < reste ? 1 : 0) };
      })
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-medium text-foreground-muted">Sections retenues</p>
        <p className="text-[11px] text-foreground-muted">Dans l&apos;ordre de passage de cet article.</p>
      </div>
      {sectionIds.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
            Aucune section retenue pour l&apos;instant.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {sections.map((chosen, i) => {
              const id = chosen.sectionId;
              const section = allSections.find((s) => s.id === id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-medium text-brand">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">
                    {section?.name ?? "Section inconnue"}
                    {section?.categorieNom && (
                      <span className="ml-1.5 text-[11px] text-foreground-muted">{section.categorieNom}</span>
                    )}
                  </span>
                  <label className="flex shrink-0 items-center gap-1 text-xs text-foreground-muted">
                    <input
                      key={`${id}-${chosen.quantite ?? "total"}`}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      defaultValue={quantiteEffective(chosen)}
                      disabled={pending}
                      aria-label={`Pièces à faire — ${section?.name ?? "section"}`}
                      onBlur={(e) => setQuantite(id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className="h-7 w-16 rounded-md border border-border bg-surface px-1.5 text-right text-xs text-foreground outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                    />
                    pcs
                  </label>
                  <button
                    type="button"
                    onClick={() => moveSection(i, -1)}
                    disabled={pending || i === 0}
                    title="Monter"
                    className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, 1)}
                    disabled={pending || i === sections.length - 1}
                    title="Descendre"
                    className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(id)}
                    disabled={pending}
                    title="Retirer"
                    className="text-foreground-muted hover:text-danger disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {ecarts.map(({ categorie, group, total }) => (
          <div
            key={categorie}
            className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs text-warning"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1 space-y-1">
              <p>
                <span className="font-medium">{categorie}</span> : {group.length} ateliers retenus pour{" "}
                {total} pièce{total > 1 ? "s" : ""} au total, alors que l&apos;article en compte {lineQuantity}.
                Si le travail est divisé entre ces ateliers, répartissez les quantités pour que leur total fasse{" "}
                {lineQuantity}.
              </p>
              <button
                type="button"
                onClick={() => repartirEgalement(group)}
                disabled={pending}
                className="font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
              >
                Répartir également
              </button>
            </div>
          </div>
        ))}

        {availableSections.length > 0 && (
          <select
            value=""
            disabled={pending}
            onChange={(e) => {
              if (e.target.value) addSection(e.target.value);
            }}
            className="mt-2 w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          >
            <option value="">+ Ajouter une section…</option>
            {availableSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
    </div>
  );
}
