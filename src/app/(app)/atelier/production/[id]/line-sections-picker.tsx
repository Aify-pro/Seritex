"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, ChevronUp, ChevronDown, AlertTriangle, Lock } from "lucide-react";
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
 *
 * Le travail peut aussi être réparti par PARTIE de la pièce plutôt que par
 * quantité (migration 0069) : une partie du T-shirt en DTF et l'autre en
 * sérigraphie, les manches à la bonneterie et le col au bunker. Une section
 * qui porte une partie travaille sur toutes les pièces de l'article, pour
 * cette partie seulement : elle sort du contrôle de quantité ci-dessus.
 *
 * Étapes (SF-1, migration 0072) : une section cochée « en même temps que la
 * précédente » partage l'étape de celle-ci — les deux travaillent en
 * parallèle. La Finition est toujours la dernière étape, seule : si aucune
 * n'est retenue, elle est ajoutée automatiquement à la soumission.
 */
type ChosenSection = { sectionId: string; quantite: number | null; partie: string | null; etape: number };

/** Étapes recalculées dans l'ordre de la liste : une section « parallèle » reprend l'étape de la précédente. */
function renumberEtapes(list: ChosenSection[], parallele: boolean[]): ChosenSection[] {
  let etape = 0;
  return list.map((s, i) => {
    if (i === 0 || !parallele[i]) etape += 1;
    return { ...s, etape };
  });
}

function paralleleFlags(list: ChosenSection[]): boolean[] {
  return list.map((s, i) => i > 0 && s.etape === list[i - 1].etape);
}

export function LineSectionsPicker({
  lineId,
  productionOrderId,
  allSections,
  lineQuantity,
  initialSections,
}: {
  lineId: string;
  productionOrderId: string;
  allSections: { id: string; name: string; categorieNom: string | null; categorieCle?: string | null; requiertVisuel: boolean }[];
  lineQuantity: number;
  initialSections: ChosenSection[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sections, setSections] = useState<ChosenSection[]>(initialSections);

  const categorieOf = (id: string) => allSections.find((a) => a.id === id)?.categorieCle ?? null;
  const isFinition = (id: string) => categorieOf(id) === "finition";
  const hasFinition = sections.some((s) => isFinition(s.sectionId));
  const parallele = paralleleFlags(sections);
  // Mélange « par partie » / « par quantité » dans une même étape : refusé à la soumission (Q-SF-6).
  const etapesMixtes = [...new Set(sections.map((s) => s.etape))].filter((etape) => {
    const group = sections.filter((s) => s.etape === etape);
    const avecPartie = group.filter((s) => s.partie).length;
    return group.length > 1 && avecPartie > 0 && avecPartie < group.length;
  });
  const premiereEtape = sections[0]?.etape;
  const coupeHorsDebut = sections.some(
    (s) => ["coupe", "stock"].includes(categorieOf(s.sectionId) ?? "") && s.etape !== premiereEtape
  );

  const sectionIds = sections.map((s) => s.sectionId);
  const availableSections = allSections.filter((s) => !sectionIds.includes(s.id));
  const quantiteEffective = (s: ChosenSection) => s.quantite ?? lineQuantity;

  // Étapes où plusieurs ateliers travaillent en parallèle en se partageant
  // les PIÈCES (sans partie renseignée) et dont le total ne correspond pas à
  // la quantité de l'article.
  const byEtape = new Map<number, ChosenSection[]>();
  for (const s of sections) {
    if (s.partie) continue;
    byEtape.set(s.etape, [...(byEtape.get(s.etape) ?? []), s]);
  }
  const ecarts = [...byEtape.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([etape, group]) => ({
      categorie: `Étape ${etape}`,
      group,
      total: group.reduce((somme, s) => somme + quantiteEffective(s), 0),
    }))
    .filter((e) => e.total !== lineQuantity);

  function persist(next: ChosenSection[], flags?: boolean[]) {
    // La Finition reste toujours en dernier, seule dans son étape.
    const finitions = next.filter((x) => isFinition(x.sectionId));
    const autres = next.filter((x) => !isFinition(x.sectionId));
    const ordered = [...autres, ...finitions];
    const baseFlags = flags ?? paralleleFlags(next);
    const flagById = new Map(next.map((x, i) => [x.sectionId, baseFlags[i] ?? false]));
    next = renumberEtapes(
      ordered,
      ordered.map((x, i) => i > 0 && !isFinition(x.sectionId) && (flagById.get(x.sectionId) ?? false))
    );
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
    persist([...sections, { sectionId: id, quantite: null, partie: null, etape: 0 }], [...parallele, false]);
  }

  function removeSection(id: string) {
    const index = sections.findIndex((s) => s.sectionId === id);
    persist(
      sections.filter((s) => s.sectionId !== id),
      parallele.filter((_, i) => i !== index)
    );
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    const flags = [...parallele];
    [next[index], next[target]] = [next[target], next[index]];
    [flags[index], flags[target]] = [flags[target], flags[index]];
    persist(next, flags);
  }

  function setParallele(index: number, value: boolean) {
    const flags = [...parallele];
    flags[index] = value;
    persist(sections, flags);
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

  function setPartie(id: string, raw: string) {
    const partie = raw.trim() || null;
    const current = sections.find((s) => s.sectionId === id);
    if (!current || current.partie === partie) return;
    persist(sections.map((s) => (s.sectionId === id ? { ...s, partie } : s)));
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
        <p className="text-[11px] text-foreground-muted">
          Dans l&apos;ordre de passage de cet article. Cochez « en parallèle » pour qu&apos;une section travaille en
          même temps que la précédente. Si deux ateliers se partagent les pièces, répartissez les quantités ;
          s&apos;ils se partagent la pièce elle-même (ex. manches / col), indiquez la partie de chacun. La Finition
          ferme toujours le parcours.
        </p>
      </div>
      <datalist id="parties-suggestions">
        <option value="Manches" />
        <option value="Col" />
        <option value="Poitrine" />
        <option value="Dos" />
        <option value="Devant" />
        <option value="Poche" />
      </datalist>
      {sectionIds.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
            Aucune section retenue pour l&apos;instant.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {sections.map((chosen, i) => {
              const id = chosen.sectionId;
              const section = allSections.find((s) => s.id === id);
              const finition = isFinition(id);
              return (
                <li
                  key={id}
                  className={`flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm ${
                    parallele[i] ? "ml-6" : ""
                  }`}
                >
                  <span
                    title={`Étape ${chosen.etape}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-medium text-brand"
                  >
                    {chosen.etape}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">
                    {section?.name ?? "Section inconnue"}
                    {section?.categorieNom && (
                      <span className="ml-1.5 text-[11px] text-foreground-muted">{section.categorieNom}</span>
                    )}
                  </span>
                  {i > 0 && !finition && (
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={parallele[i]}
                        disabled={pending}
                        onChange={(e) => setParallele(i, e.target.checked)}
                      />
                      en parallèle
                    </label>
                  )}
                  {finition && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-foreground-muted">
                      <Lock className="h-3 w-3" /> dernière étape
                    </span>
                  )}
                  <input
                    key={`${id}-partie-${chosen.partie ?? ""}`}
                    type="text"
                    maxLength={80}
                    list="parties-suggestions"
                    defaultValue={chosen.partie ?? ""}
                    disabled={pending}
                    placeholder="Partie (ex. manches)"
                    aria-label={`Partie de la pièce — ${section?.name ?? "section"}`}
                    onBlur={(e) => setPartie(id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="h-7 w-36 shrink-0 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground outline-none placeholder:text-foreground-muted/70 focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                  />
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
                    disabled={pending || i === 0 || finition}
                    title="Monter"
                    className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, 1)}
                    disabled={pending || i === sections.length - 1 || finition || isFinition(sections[i + 1]?.sectionId ?? "")}
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

        {!hasFinition && (
          <p className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-foreground-muted">
            <Lock className="h-3 w-3" /> Finition — ajoutée automatiquement en dernière étape à la soumission.
          </p>
        )}

        {etapesMixtes.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Étape {etapesMixtes.join(", ")} : mélange de sections « par partie » et « par quantité ». Séparez-les en deux
            étapes, sinon la soumission sera refusée.
          </p>
        )}

        {coupeHorsDebut && (
          <p className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La Coupe (ou le Stock) ne peut être que la première étape du parcours.
          </p>
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
