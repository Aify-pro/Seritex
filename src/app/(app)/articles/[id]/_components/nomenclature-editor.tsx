"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addNomenclatureLine, linkNomenclatureLine, removeNomenclatureLine, setNomenclatureLineCouleur } from "../../actions";
import { Plus, Trash2 } from "lucide-react";

interface NomenclatureRow {
  id: string;
  designation: string;
  quantite_par_piece: number;
  unite: string;
  consumable_id?: string | null;
  semi_fini_id?: string | null;
  zone_key?: string | null;
  couleur_imposee_id?: string | null;
}

export interface ConsumableOption {
  id: string;
  code: string;
  designation: string;
  unite: string;
}

export interface SemiFiniOption {
  id: string;
  code: string | null;
  name: string;
}

export interface ZoneOption {
  zone_key: string;
  zone_label: string;
}

export interface CouleurOption {
  id: string;
  name: string;
}

const champ = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

/**
 * Couleur d'une ligne, en une seule liste : celle du produit fini (couleur
 * unique ou zone du modèle) ou une couleur imposée. Valeur codée « z:<zone> »
 * ou « c:<couleur> » ; vide = couleur unique du produit fini.
 */
function couleurValue(l: { zone_key?: string | null; couleur_imposee_id?: string | null }) {
  if (l.couleur_imposee_id) return `c:${l.couleur_imposee_id}`;
  if (l.zone_key) return `z:${l.zone_key}`;
  return "";
}

function couleurInput(value: string) {
  return {
    zone_key: value.startsWith("z:") ? value.slice(2) : "",
    couleur_imposee_id: value.startsWith("c:") ? value.slice(2) : "",
  };
}

function CouleurOptions({ zones, couleurs }: { zones: ZoneOption[]; couleurs: CouleurOption[] }) {
  return (
    <>
      <option value="">Couleur du produit fini</option>
      {zones.length > 0 && (
        <optgroup label="Couleur de la zone">
          {zones.map((z) => (
            <option key={z.zone_key} value={`z:${z.zone_key}`}>
              {z.zone_label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Couleur imposée">
        {couleurs.map((c) => (
          <option key={c.id} value={`c:${c.id}`}>
            {c.name}
          </option>
        ))}
      </optgroup>
    </>
  );
}

/**
 * Nomenclature d'un produit fini (lot 12, COM-G, 0143) : les semi-finis qui
 * le composent (manches, col, corps…, en pièces entières) et les consommables
 * hors tissu (boutons, fil, étiquettes, emballage…) avec leur quantité par
 * pièce. Chaque ligne prend la couleur du produit fini — sa couleur unique ou
 * celle d'une zone — sauf couleur imposée ; une demande spéciale du client se
 * traitera sur la ligne d'ODF. Le tissu reste celui du produit fini. Seules
 * les lignes consommables comptent dans la consommation à la clôture des ODF.
 */
export function NomenclatureEditor({
  productModelId,
  lines,
  consumables,
  semiFinis,
  zones,
  couleurs,
}: {
  productModelId: string;
  lines: NomenclatureRow[];
  consumables: ConsumableOption[];
  semiFinis: SemiFiniOption[];
  zones: ZoneOption[];
  couleurs: CouleurOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [genre, setGenre] = useState<"semi_fini" | "consommable">(semiFinis.length > 0 ? "semi_fini" : "consommable");
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function remove(lineId: string) {
    startTransition(async () => {
      const res = await removeNomenclatureLine(lineId);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  function changeCouleur(lineId: string, value: string) {
    startTransition(async () => {
      const res = await setNomenclatureLineCouleur(lineId, couleurInput(value));
      if (res?.error) toast.error("Couleur non enregistrée", { description: res.error });
      else router.refresh();
    });
  }

  // Semi-finis d'abord : ils composent le vêtement ; puis les consommables.
  const ordered = [...lines.filter((l) => l.semi_fini_id), ...lines.filter((l) => !l.semi_fini_id)];

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-foreground-muted">Nomenclature</p>

      {ordered.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {ordered.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-foreground">
                {(() => {
                  if (l.semi_fini_id) {
                    const s = semiFinis.find((x) => x.id === l.semi_fini_id);
                    return (
                      <>
                        <span className="mr-1.5 font-mono text-xs text-foreground-muted">{s?.code ?? "SF"}</span>
                        {s?.name ?? l.designation}
                      </>
                    );
                  }
                  const c = consumables.find((x) => x.id === l.consumable_id);
                  return c ? (
                    <>
                      <span className="mr-1.5 font-mono text-xs text-foreground-muted">{c.code}</span>
                      {c.designation}
                    </>
                  ) : (
                    <>
                      {l.designation}{" "}
                      <select
                        defaultValue=""
                        disabled={pending}
                        onChange={(e) =>
                          e.target.value &&
                          startTransition(async () => {
                            const res = await linkNomenclatureLine(l.id, e.target.value);
                            if (res?.error) toast.error(res.error);
                            else router.refresh();
                          })
                        }
                        className="ml-1 h-7 rounded-md border border-warning bg-surface px-1 text-xs"
                        aria-label="Relier à un consommable"
                      >
                        <option value="">Relier à un consommable…</option>
                        {consumables.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.code} · {o.designation}
                          </option>
                        ))}
                      </select>
                    </>
                  );
                })()}
              </span>
              <span className="flex items-center gap-2">
                <select
                  value={couleurValue(l)}
                  disabled={pending}
                  onChange={(e) => changeCouleur(l.id, e.target.value)}
                  className="h-7 max-w-44 rounded-md border border-border bg-surface px-1 text-xs"
                  aria-label={`Couleur de ${l.designation}`}
                >
                  <CouleurOptions zones={zones} couleurs={couleurs} />
                </select>
                <span className="text-foreground-muted">
                  {l.quantite_par_piece} {l.unite} / pièce
                </span>
                <button
                  disabled={pending}
                  onClick={() => remove(l.id)}
                  className="rounded-full p-0.5 opacity-60 hover:bg-danger-soft hover:text-danger hover:opacity-100 disabled:opacity-30"
                  aria-label={`Retirer ${l.designation}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {lines.length === 0 && <p className="text-xs text-foreground-muted">Aucune ligne de nomenclature.</p>}
      {semiFinis.length === 0 && (
        <p className="text-xs text-foreground-muted">Aucun semi-fini : créez-les dans Articles &gt; Nouvel article, nature « Semi-fini ».</p>
      )}
      {consumables.length === 0 && (
        <p className="text-xs text-warning">Aucun consommable au référentiel : créez-les d&apos;abord (Articles &gt; Consommables).</p>
      )}

      {!open ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
        </Button>
      ) : (
        <form
          ref={formRef}
          action={(formData) =>
            startTransition(async () => {
              const res = await addNomenclatureLine(formData);
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Ligne ajoutée");
                formRef.current?.reset();
                setOpen(false);
                router.refresh();
              }
            })
          }
          className="space-y-2"
        >
          <input type="hidden" name="product_model_id" value={productModelId} />
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Type de ligne">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={genre === "semi_fini"} onChange={() => setGenre("semi_fini")} /> Semi-fini
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={genre === "consommable"} onChange={() => setGenre("consommable")} /> Consommable
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {genre === "semi_fini" ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Semi-fini</label>
                <select key="semi_fini" name="semi_fini_id" required className={`${champ} w-60`}>
                  <option value="">— Choisir —</option>
                  {semiFinis.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code ? `${s.code} · ` : ""}
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Consommable</label>
                <select key="consommable" name="consumable_id" required className={`${champ} w-60`}>
                  <option value="">— Choisir —</option>
                  {consumables.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.designation} ({c.unite})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Quantité / pièce</label>
              <input
                key={genre}
                name="quantite_par_piece"
                type="number"
                step={genre === "semi_fini" ? "1" : "0.001"}
                min={genre === "semi_fini" ? "1" : "0"}
                required
                placeholder={genre === "semi_fini" ? "1" : "4"}
                className={`${champ} w-24`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Couleur</label>
              <select
                name="couleur"
                defaultValue=""
                className={`${champ} w-52`}
                onChange={(e) => {
                  const form = e.currentTarget.form;
                  if (!form) return;
                  const v = couleurInput(e.target.value);
                  (form.elements.namedItem("zone_key") as HTMLInputElement).value = v.zone_key;
                  (form.elements.namedItem("couleur_imposee_id") as HTMLInputElement).value = v.couleur_imposee_id;
                }}
              >
                <CouleurOptions zones={zones} couleurs={couleurs} />
              </select>
              <input type="hidden" name="zone_key" defaultValue="" />
              <input type="hidden" name="couleur_imposee_id" defaultValue="" />
            </div>
            <Button type="submit" size="sm" loading={pending}>
              Ajouter
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
