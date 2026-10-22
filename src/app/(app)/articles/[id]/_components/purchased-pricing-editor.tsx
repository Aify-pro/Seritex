"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/currency";
import { purchasedSalePrice, type PricingParams } from "@/lib/pricing";
import { FAMILLE_LABELS } from "@/app/(app)/parametres/couleurs/color-fields";
import { saveArticlePurchasePricing, saveFamilyPricing, saveVariantPricing } from "../prix-de-revient/actions";

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm";

export interface ArticlePurchase {
  mode: "calcule" | "saisi";
  prixAchat: number | null;
  fraisPct: number;
  prixVente: number | null;
  chargesPct: number | null;
  margePct: number | null;
}
export type Famille = keyof typeof FAMILLE_LABELS;
/** Ordre du sélecteur : du plus cher au moins cher chez le fournisseur. */
const FAMILLES: Famille[] = ["fonce", "moyen", "clair", "blanc"];

/** Valeurs d'une famille de couleur (migration 0142) ; null = valeur de l'article. */
export interface FamilyPurchase {
  mode: "calcule" | "saisi" | null;
  prixAchat: number | null;
  fraisPct: number | null;
  prixVente: number | null;
}
export interface VariantPurchase {
  id: string;
  code: string;
  label: string;
  /** Famille de la couleur de la déclinaison, null si la couleur n'en a pas. */
  famille: Famille | null;
  mode: "calcule" | "saisi" | null;
  prixAchat: number | null;
  fraisPct: number | null;
  prixVente: number | null;
}

/**
 * Prix de revient d'un tissu ou d'un consommable (migration 0104) : au choix
 * calculé — achat + frais d'approche × coefficient, arrondi — ou saisi. Les
 * valeurs de l'article valent pour toutes ses déclinaisons, qui peuvent les
 * remplacer. Une famille de couleur (Foncé, Moyen, Clair, Blanc — migration
 * 0142) peut aussi remplacer l'article pour toutes ses déclinaisons : chaque
 * valeur se lit déclinaison → famille → article. Direction et administrateur
 * seulement.
 */
export function PurchasedPricingEditor({
  productModelId,
  unite,
  defaults,
  initial,
  families,
  variants,
}: {
  productModelId: string;
  unite: string;
  defaults: PricingParams;
  initial: ArticlePurchase;
  families: Partial<Record<Famille, FamilyPurchase>>;
  variants: VariantPurchase[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [a, setA] = useState({
    mode: initial.mode,
    prixAchat: str(initial.prixAchat),
    fraisPct: str(initial.fraisPct),
    prixVente: str(initial.prixVente),
    chargesPct: str(initial.chargesPct),
    margePct: str(initial.margePct),
  });
  const params: PricingParams = {
    chargesPct: num(a.chargesPct) ?? defaults.chargesPct,
    margePct: num(a.margePct) ?? defaults.margePct,
    arrondi: defaults.arrondi,
    coefPrixVente: num(a.chargesPct) == null && num(a.margePct) == null ? defaults.coefPrixVente ?? null : null,
  };
  const [famille, setFamille] = useState<Famille | null>(null);
  const article = purchasedSalePrice({ mode: a.mode, prixAchat: num(a.prixAchat), fraisPct: num(a.fraisPct) ?? 0, prixVenteSaisi: num(a.prixVente) }, params);

  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error("Enregistrement refusé", { description: res.error });
      else {
        toast.success(ok);
        router.refresh();
      }
    });

  const shown = famille === null ? variants : variants.filter((v) => v.famille === famille);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">Prix de l&apos;article</p>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Famille de couleur">
          {[null, ...FAMILLES].map((f) => {
            const n = f === null ? variants.length : variants.filter((v) => v.famille === f).length;
            const saisi = f !== null && !!families[f];
            return (
              <button
                key={f ?? "tout"}
                type="button"
                role="tab"
                aria-selected={famille === f}
                onClick={() => setFamille(f)}
                className={`rounded-full border px-3 py-1 text-sm ${famille === f ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface"}`}
              >
                {f === null ? "Tout" : FAMILLE_LABELS[f]}
                <span className="ml-1 text-xs text-foreground-muted">{n}</span>
                {saisi && <span className="ml-1 text-brand" title="Prix propre à cette famille">•</span>}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-foreground-muted">
          {famille === null
            ? "Tout : valeurs de toutes les déclinaisons, sauf celles qu'une famille ou une déclinaison remplace."
            : `${FAMILLE_LABELS[famille]} : remplace l'article pour les déclinaisons de couleur ${FAMILLE_LABELS[famille].toLowerCase()} ; une case vide reprend « Tout ». La famille d'une couleur se règle dans Paramètres > Couleurs et tailles.`}
        </p>
      </div>

      {famille !== null ? (
        <FamilyForm
          key={famille}
          productModelId={productModelId}
          famille={famille}
          initial={families[famille] ?? null}
          article={a}
          params={params}
          unite={unite}
          pending={pending}
          run={run}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["calcule", "saisi"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setA({ ...a, mode: m })}
                className={`rounded-md border px-3 py-1.5 text-sm ${a.mode === m ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface"}`}
              >
                {m === "calcule" ? "Prix calculé" : "Prix saisi"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              <span className="mb-1 block text-foreground-muted">Prix d&apos;achat / {unite}</span>
              <input value={a.prixAchat} inputMode="decimal" onChange={(e) => setA({ ...a, prixAchat: e.target.value })} className={`${input} w-32`} />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-foreground-muted">Frais d&apos;approche (%)</span>
              <input value={a.fraisPct} inputMode="decimal" onChange={(e) => setA({ ...a, fraisPct: e.target.value })} className={`${input} w-24`} />
            </label>
            {a.mode === "calcule" ? (
              <>
                <label className="text-xs">
                  <span className="mb-1 block text-foreground-muted">Charges (%)</span>
                  <input value={a.chargesPct} placeholder={String(defaults.chargesPct)} inputMode="decimal" onChange={(e) => setA({ ...a, chargesPct: e.target.value })} className={`${input} w-20`} />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-foreground-muted">Marge (%)</span>
                  <input value={a.margePct} placeholder={String(defaults.margePct)} inputMode="decimal" onChange={(e) => setA({ ...a, margePct: e.target.value })} className={`${input} w-20`} />
                </label>
              </>
            ) : (
              <label className="text-xs">
                <span className="mb-1 block text-foreground-muted">Prix de vente / {unite}</span>
                <input value={a.prixVente} inputMode="decimal" onChange={(e) => setA({ ...a, prixVente: e.target.value })} className={`${input} w-32`} />
              </label>
            )}
            <Button
              size="sm"
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    saveArticlePurchasePricing(productModelId, {
                      mode_prix: a.mode,
                      prix_achat: num(a.prixAchat),
                      frais_pct: num(a.fraisPct) ?? 0,
                      prix_vente: num(a.prixVente),
                      charges_pct: num(a.chargesPct),
                      marge_pct: num(a.margePct),
                    }),
                  "Prix de l'article enregistré"
                )
              }
            >
              Enregistrer
            </Button>
          </div>
          <p className="text-xs text-foreground-muted">
            Prix de revient : {article.prixRevient != null ? `${formatMoney(Math.round(article.prixRevient))} / ${unite}` : "—"} · prix de vente :{" "}
            <span className="font-medium text-foreground">{article.prixVente != null ? `${formatMoney(article.prixVente)} / ${unite}` : article.manquant}</span>
          </p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Par déclinaison{famille !== null ? ` — ${FAMILLE_LABELS[famille]}` : ""}</p>
        <p className="text-xs text-foreground-muted">Laissez vide pour reprendre la valeur de la famille, sinon de l&apos;article ; renseignez une case pour la remplacer sur cette déclinaison.</p>
        {shown.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            {variants.length === 0 ? <>Aucune déclinaison active : générez-les dans l&apos;onglet Déclinaisons.</> : "Aucune déclinaison de cette famille."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-foreground-muted">
                  <th className="py-1 pr-3">Code</th>
                  <th className="py-1 pr-3">Déclinaison</th>
                  <th className="py-1 pr-3">Mode</th>
                  <th className="py-1 pr-3">Achat / {unite}</th>
                  <th className="py-1 pr-3">Frais %</th>
                  <th className="py-1 pr-3">PV saisi</th>
                  <th className="py-1 pr-3 text-right">Prix de vente</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <VariantRow key={v.id} v={v} base={inherited(a, v.famille ? families[v.famille] : undefined)} params={params} unite={unite} pending={pending} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function VariantRow({
  v,
  base,
  params,
  unite,
  pending,
  run,
}: {
  v: VariantPurchase;
  /** Valeurs reprises quand une case est vide : famille de la couleur, sinon article. */
  base: Inherited;
  params: PricingParams;
  unite: string;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string }>, ok: string) => void;
}) {
  const [r, setR] = useState({ mode: v.mode ?? "", prixAchat: str(v.prixAchat), fraisPct: str(v.fraisPct), prixVente: str(v.prixVente) });
  const effectif = purchasedSalePrice(
    {
      mode: (r.mode || base.mode) as "calcule" | "saisi",
      prixAchat: num(r.prixAchat) ?? num(base.prixAchat),
      fraisPct: num(r.fraisPct) ?? num(base.fraisPct) ?? 0,
      prixVenteSaisi: num(r.prixVente) ?? num(base.prixVente),
    },
    params
  );
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3 font-mono text-xs">{v.code}</td>
      <td className="py-1 pr-3">{v.label}</td>
      <td className="py-1 pr-3">
        <select value={r.mode} onChange={(e) => setR({ ...r, mode: e.target.value })} className={input} aria-label="Mode">
          <option value="">{base.fromFamily ? "Comme la famille" : "Comme l'article"}</option>
          <option value="calcule">Calculé</option>
          <option value="saisi">Saisi</option>
        </select>
      </td>
      <td className="py-1 pr-3">
        <input value={r.prixAchat} inputMode="decimal" onChange={(e) => setR({ ...r, prixAchat: e.target.value })} placeholder={base.prixAchat} className={`${input} w-24`} />
      </td>
      <td className="py-1 pr-3">
        <input value={r.fraisPct} inputMode="decimal" onChange={(e) => setR({ ...r, fraisPct: e.target.value })} placeholder={base.fraisPct} className={`${input} w-16`} />
      </td>
      <td className="py-1 pr-3">
        <input value={r.prixVente} inputMode="decimal" onChange={(e) => setR({ ...r, prixVente: e.target.value })} placeholder={base.prixVente} className={`${input} w-24`} />
      </td>
      <td className="py-1 pr-3 text-right tabular-nums">{effectif.prixVente != null ? `${formatMoney(effectif.prixVente)} / ${unite}` : "—"}</td>
      <td className="py-1">
        <Button
          size="sm"
          variant="ghost"
          loading={pending}
          onClick={() =>
            run(
              () =>
                saveVariantPricing(v.id, {
                  mode_prix: (r.mode || null) as "calcule" | "saisi" | null,
                  prix_achat: num(r.prixAchat),
                  frais_pct: num(r.fraisPct),
                  prix_vente: num(r.prixVente),
                }),
              `${v.code} enregistrée`
            )
          }
        >
          Enregistrer
        </Button>
      </td>
    </tr>
  );
}

/** Valeurs héritées par une déclinaison ou une famille, en texte comme les champs. */
interface Inherited {
  mode: "calcule" | "saisi";
  prixAchat: string;
  fraisPct: string;
  prixVente: string;
  fromFamily: boolean;
}

function inherited(article: { mode: "calcule" | "saisi"; prixAchat: string; fraisPct: string; prixVente: string }, fam: FamilyPurchase | undefined): Inherited {
  return {
    mode: fam?.mode ?? article.mode,
    prixAchat: fam?.prixAchat != null ? String(fam.prixAchat) : article.prixAchat,
    fraisPct: fam?.fraisPct != null ? String(fam.fraisPct) : article.fraisPct,
    prixVente: fam?.prixVente != null ? String(fam.prixVente) : article.prixVente,
    fromFamily: !!fam,
  };
}

/** Saisie d'une famille de couleur : cases vides = valeurs de l'article (« Tout »). */
function FamilyForm({
  productModelId,
  famille,
  initial,
  article,
  params,
  unite,
  pending,
  run,
}: {
  productModelId: string;
  famille: Famille;
  initial: FamilyPurchase | null;
  article: { mode: "calcule" | "saisi"; prixAchat: string; fraisPct: string; prixVente: string };
  params: PricingParams;
  unite: string;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string }>, ok: string) => void;
}) {
  const [f, setF] = useState({ mode: initial?.mode ?? "", prixAchat: str(initial?.prixAchat), fraisPct: str(initial?.fraisPct), prixVente: str(initial?.prixVente) });
  const mode = (f.mode || article.mode) as "calcule" | "saisi";
  const effectif = purchasedSalePrice(
    {
      mode,
      prixAchat: num(f.prixAchat) ?? num(article.prixAchat),
      fraisPct: num(f.fraisPct) ?? num(article.fraisPct) ?? 0,
      prixVenteSaisi: num(f.prixVente) ?? num(article.prixVente),
    },
    params
  );
  const label = FAMILLE_LABELS[famille];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block text-foreground-muted">Mode</span>
          <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} className={input}>
            <option value="">Comme l&apos;article ({article.mode === "calcule" ? "calculé" : "saisi"})</option>
            <option value="calcule">Calculé</option>
            <option value="saisi">Saisi</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-foreground-muted">Prix d&apos;achat / {unite}</span>
          <input value={f.prixAchat} inputMode="decimal" placeholder={article.prixAchat} onChange={(e) => setF({ ...f, prixAchat: e.target.value })} className={`${input} w-32`} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-foreground-muted">Frais d&apos;approche (%)</span>
          <input value={f.fraisPct} inputMode="decimal" placeholder={article.fraisPct} onChange={(e) => setF({ ...f, fraisPct: e.target.value })} className={`${input} w-24`} />
        </label>
        {mode === "saisi" && (
          <label className="text-xs">
            <span className="mb-1 block text-foreground-muted">Prix de vente / {unite}</span>
            <input value={f.prixVente} inputMode="decimal" placeholder={article.prixVente} onChange={(e) => setF({ ...f, prixVente: e.target.value })} className={`${input} w-32`} />
          </label>
        )}
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            run(
              () =>
                saveFamilyPricing(productModelId, {
                  famille,
                  mode_prix: (f.mode || null) as "calcule" | "saisi" | null,
                  prix_achat: num(f.prixAchat),
                  frais_pct: num(f.fraisPct),
                  prix_vente: num(f.prixVente),
                }),
              `Prix ${label.toLowerCase()} enregistré`
            )
          }
        >
          Enregistrer
        </Button>
      </div>
      <p className="text-xs text-foreground-muted">
        Charges et marge : celles de l&apos;article (onglet Tout). Prix de revient :{" "}
        {effectif.prixRevient != null ? `${formatMoney(Math.round(effectif.prixRevient))} / ${unite}` : "—"} · prix de vente :{" "}
        <span className="font-medium text-foreground">{effectif.prixVente != null ? `${formatMoney(effectif.prixVente)} / ${unite}` : effectif.manquant}</span>
      </p>
    </div>
  );
}
