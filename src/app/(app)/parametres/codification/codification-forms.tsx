"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CODE_SEGMENT_LABELS,
  CODING_NATURE_RULES,
  variantCode,
  type CodeSegment,
  type CodingNature,
  type CodingSettings,
} from "@/lib/articles/codification";
import {
  createNamedReferential,
  saveCodingRule,
  setSageDepot,
  setTextileMatiere,
  updateShortCode,
} from "./actions";

/**
 * Règle de codification d'une nature d'article (migration 0102) : segments
 * retenus et leur ordre, longueur maximale, séparateur — avec aperçu.
 */
export function CodingSettingsForm({ nature, initial, editable }: { nature: CodingNature; initial: CodingSettings; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const rule = CODING_NATURE_RULES[nature];
  const CODE_SEGMENTS = rule.segments;
  const [segments, setSegments] = useState<CodeSegment[]>(initial.segments);
  const [longueurMax, setLongueurMax] = useState(initial.longueurMax);
  const [separateur, setSeparateur] = useState(initial.separateur);
  const apercu = variantCode(rule.exemple, { segments, longueurMax, separateur }, { etatSuffix: rule.etatSuffix, optional: rule.optional });

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= segments.length) return;
    const next = [...segments];
    [next[i], next[j]] = [next[j], next[i]];
    setSegments(next);
  };

  return (
    <div className="space-y-3">
      <ol className="space-y-1.5">
        {CODE_SEGMENTS.filter((s) => segments.includes(s))
          .sort((a, b) => segments.indexOf(a) - segments.indexOf(b))
          .map((s, i) => (
            <li key={s} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
              <span className="w-5 text-xs text-foreground-muted">{i + 1}.</span>
              <span className="flex-1">{CODE_SEGMENT_LABELS[s]}</span>
              {editable && (
                <>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-30" aria-label="Monter">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === segments.length - 1} className="disabled:opacity-30" aria-label="Descendre">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {!rule.required.includes(s) && (
                    <button type="button" onClick={() => setSegments(segments.filter((x) => x !== s))} className="text-xs text-foreground-muted hover:text-danger">
                      Retirer
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
      </ol>
      {editable && CODE_SEGMENTS.some((s) => !segments.includes(s)) && (
        <div className="flex flex-wrap gap-1.5">
          {CODE_SEGMENTS.filter((s) => !segments.includes(s)).map((s) => (
            <Button key={s} size="sm" variant="ghost" onClick={() => setSegments([...segments, s])}>
              <Plus className="h-3.5 w-3.5" /> {CODE_SEGMENT_LABELS[s]}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Longueur maximale (référence Sage)</span>
          <input
            type="number"
            min={8}
            max={40}
            value={longueurMax}
            disabled={!editable}
            onChange={(e) => setLongueurMax(Number(e.target.value))}
            className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Séparateur</span>
          <input
            maxLength={1}
            value={separateur}
            disabled={!editable}
            placeholder="aucun"
            onChange={(e) => setSeparateur(e.target.value)}
            className="h-9 w-20 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </label>
        {editable && (
          <Button
            size="sm"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await saveCodingRule(nature, { segments, longueurMax, separateur });
                if (res.error) toast.error("Réglage refusé", { description: res.error });
                else {
                  toast.success("Règle de codification enregistrée");
                  router.refresh();
                }
              })
            }
          >
            Enregistrer
          </Button>
        )}
      </div>
      <p className="text-xs text-foreground-muted">
        Aperçu :{" "}
        {"code" in apercu ? (
          rule.etatSuffix ? (
            <>
              <span className="font-mono text-foreground">{apercu.code}</span> · personnalisé{" "}
              <span className="font-mono">{apercu.code}P</span> · 2e choix <span className="font-mono">{apercu.code}D</span>
            </>
          ) : (
            <span className="font-mono text-foreground">{apercu.code}</span>
          )
        ) : (
          <span className="text-danger">{apercu.error}</span>
        )}
      </p>
    </div>
  );
}

/** Code court modifiable en place (enregistré à la sortie du champ). */
export function ShortCodeInput({
  table,
  id,
  value,
  editable,
  max = 4,
}: {
  table: "product_categories" | "matieres" | "textiles" | "colors" | "sizes" | "consumable_families";
  id: string;
  value: string | null;
  editable: boolean;
  max?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!editable) return <span className="font-mono text-xs">{value ?? "—"}</span>;
  return (
    <input
      key={value ?? ""}
      defaultValue={value ?? ""}
      maxLength={max}
      disabled={pending}
      aria-label="Code court"
      onBlur={(e) => {
        const next = e.target.value.trim().toUpperCase();
        if (next === (value ?? "")) return;
        startTransition(async () => {
          const res = await updateShortCode(table, id, next);
          if (res.error) {
            toast.error("Code court refusé", { description: res.error });
            e.target.value = value ?? "";
          } else router.refresh();
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-8 w-20 rounded-md border border-border bg-surface px-2 font-mono text-xs uppercase disabled:opacity-60"
    />
  );
}

/** Ajout d'une catégorie ou d'une matière (nom + code court). */
export function NamedReferentialForm({
  table,
  label,
  codeLength = 4,
}: {
  table: "product_categories" | "matieres" | "consumable_families";
  label: string;
  codeLength?: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await createNamedReferential(table, fd);
          if (res.error) toast.error("Ajout refusé", { description: res.error });
          else {
            formRef.current?.reset();
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <input name="nom" required placeholder={label} className="h-8 w-44 rounded-md border border-border bg-surface px-2 text-sm" />
      <input
        name="code_court"
        required
        maxLength={codeLength}
        placeholder="Code"
        className="h-8 w-20 rounded-md border border-border bg-surface px-2 font-mono text-xs uppercase"
      />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </form>
  );
}

export function TextileMatiereSelect({
  textileId,
  matiereId,
  matieres,
  editable,
}: {
  textileId: string;
  matiereId: string | null;
  matieres: { id: string; nom: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      value={matiereId ?? ""}
      disabled={!editable || pending}
      onChange={(e) =>
        startTransition(async () => {
          const res = await setTextileMatiere(textileId, e.target.value || null);
          if (res.error) toast.error("Modification refusée", { description: res.error });
          else router.refresh();
        })
      }
      className="h-8 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
    >
      <option value="">—</option>
      {matieres.map((m) => (
        <option key={m.id} value={m.id}>
          {m.nom}
        </option>
      ))}
    </select>
  );
}

export function SageDepotInput({ nature, depot, editable }: { nature: string; depot: string | null; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!editable) return <span className="text-sm">{depot ?? "—"}</span>;
  return (
    <input
      key={depot ?? ""}
      defaultValue={depot ?? ""}
      disabled={pending}
      placeholder="Dépôt Sage"
      onBlur={(e) => {
        if (e.target.value.trim() === (depot ?? "")) return;
        startTransition(async () => {
          const res = await setSageDepot(nature, e.target.value);
          if (res.error) toast.error("Modification refusée", { description: res.error });
          else router.refresh();
        });
      }}
      className="h-8 w-40 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
    />
  );
}
