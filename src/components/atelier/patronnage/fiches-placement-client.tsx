"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  Eye,
  Upload,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  Archive,
  ArchiveRestore,
  Search,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { QrScannerButton } from "@/components/atelier/patronnage/qr-scanner-button";
import { SelecteurEchelle, TraceDownloadMenu, TracePiecesPanel } from "@/components/atelier/patronnage/trace-pieces-panel";
import { STATUT_TRACE_LABELS, STATUT_TRACE_TONES, type FichePlacement, type RepartitionTailles, type StatutFiche, type TracePlacement } from "@/lib/patronnage/types";
import { createContext, useContext } from "react";
import type { Size } from "@/lib/sizes";
import { repartitionDepuisTraces, repartitionTotal } from "@/lib/patronnage/dispatching";
import { ArticlesRegroupesCard, CouchesEditor, NouvelOrdreRegroupeDialog } from "@/components/atelier/patronnage/coupe-regroupee";
import {
  createFiche,
  updateFiche,
  linkLine,
  sizesForProductModel,
  archiveFiche,
  unarchiveFiche,
  deleteFicheDefinitively,
  addTrace,
  updateTrace,
  deleteTrace,
  uploadTraceDxf,
  removeTraceDxf,
  validerTrace,
  modifierTraceValide,
  annulerTrace,
  searchOdfLines,
  searchClient,
} from "@/app/(app)/atelier/patronnage/fiches-actions";

const STATUT_LABELS: Record<StatutFiche, string> = {
  demande: "Demande",
  traces_deposes: "Tracés déposés",
  bon_pour_coupe: "Bon pour coupe",
  archive: "Archivé",
};

const STATUT_TONE: Record<StatutFiche, "info" | "brand" | "success" | "neutral"> = {
  demande: "info",
  traces_deposes: "brand",
  bon_pour_coupe: "success",
  archive: "neutral",
};

interface ReferenceOption {
  pieceId: string;
  articleCode: string;
  size: string;
  name: string;
}

/** Modèle actif proposable en cadre 1, avec son textile principal (lot C1) déjà résolu côté serveur. */
interface ProductModelOption {
  id: string;
  name: string;
  textile: { nom: string | null; grammage: number | null; laizeCm: number | null } | null;
}

interface Permissions {
  canCreate: boolean;
  canModify: boolean;
  /**
   * Droits du module « Patronnage — tracés », distincts de ceux de la fiche :
   * la PAO ajoute et corrige des tracés sans pouvoir toucher un seul cadre de
   * la fiche. Un rôle qui a `modify` sur la fiche les a aussi, côté écran
   * comme côté RLS.
   */
  canAddTrace: boolean;
  canModifyTrace: boolean;
  canValidate: boolean;
  canUnlock: boolean;
  canArchive: boolean;
  canDelete: boolean;
  /** Affecter des pièces non reconnues à un patron (apprentissage via le tracé). */
  canLearn: boolean;
}


/* ============================================================
   Écran liste
============================================================ */

export function FichesPlacementClient({
  fiches,
  permissions,
  sizes = [],
  productModels = [],
  semiFinis = [],
}: {
  fiches: FichePlacement[];
  currentUserRole: string;
  permissions: Permissions;
  /** Grille de tailles active (Paramètres > Couleurs et tailles). */
  sizes?: Size[];
  /** Modèles actifs, pour le cadre 1 (lot C2). */
  productModels?: ProductModelOption[];
  /** Semi-finis actifs, pour créer un ordre de coupe regroupé (0149). */
  semiFinis?: { id: string; code: string | null; name: string }[];
}) {
  const [filtreStatut, setFiltreStatut] = useState<StatutFiche | "tous">("tous");
  const [showCreate, setShowCreate] = useState(false);
  const [showRegroupe, setShowRegroupe] = useState(false);

  const filtered = fiches.filter((f) => filtreStatut === "tous" || f.statut === filtreStatut);

  return (
    <SizesContext.Provider value={sizes}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {(["tous", "demande", "traces_deposes", "bon_pour_coupe", "archive"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFiltreStatut(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  filtreStatut === s
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border text-foreground-muted hover:text-foreground"
                )}
              >
                {s === "tous" ? "Toutes" : STATUT_LABELS[s]}
              </button>
            ))}
          </div>
          {permissions.canCreate && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowRegroupe(true)}>
                <Plus className="h-3.5 w-3.5" /> Ordre de coupe regroupé
              </Button>
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-3.5 w-3.5" /> Nouvelle fiche
              </Button>
            </div>
          )}
        </div>

        <Card>
          <CardBody className="p-0">
            <Table>
              <Thead>
                <Tr>
                  <Th>N° OT</Th>
                  <Th>Client</Th>
                  <Th>Réf. modèle</Th>
                  <Th>ODF lié</Th>
                  <Th align="center">Tracés</Th>
                  <Th>Statut</Th>
                  <Th>Émission</Th>
                  <Th>Retour souhaité</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((f) => (
                  <Tr key={f.id}>
                    <Td className="font-mono text-xs">{f.numeroOt}</Td>
                    <Td>{f.clientLibelle ?? <span className="text-foreground-muted">—</span>}</Td>
                    <Td>
                      {f.semiFini ? (
                        <span>
                          <span className="mr-1.5 rounded-sm bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">Regroupé</span>
                          {f.semiFini.name}
                        </span>
                      ) : (
                        f.designationArticle ?? f.referenceModele ?? <span className="text-foreground-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      {f.semiFini ? (
                        <span className="text-foreground">
                          {f.lignesRegroupees.length} article{f.lignesRegroupees.length > 1 ? "s" : ""} :{" "}
                          {[...new Set(f.lignesRegroupees.map((l) => l.odfReference).filter(Boolean))].join(", ")}
                        </span>
                      ) : f.odfReference ? (
                        <span className="text-foreground">{f.odfReference}</span>
                      ) : (
                        <span className="text-foreground-muted">—</span>
                      )}
                    </Td>
                    <Td align="center">{f.traces.length}</Td>
                    <Td>
                      <Badge tone={STATUT_TONE[f.statut]} dot>
                        {STATUT_LABELS[f.statut]}
                      </Badge>
                    </Td>
                    <Td>{formatDate(f.dateEmission)}</Td>
                    <Td>{formatDate(f.dateRetourSouhaitee)}</Td>
                    <Td align="right">
                      <Link href={`/atelier/patronnage/${f.id}`}>
                        <Button variant="secondary" size="sm">
                          <Eye className="h-3.5 w-3.5" /> Voir
                        </Button>
                      </Link>
                    </Td>
                  </Tr>
                ))}
                {filtered.length === 0 && <EmptyRow colSpan={9}>Aucune fiche de placement.</EmptyRow>}
              </Tbody>
            </Table>
          </CardBody>
        </Card>

        <Dialog open={showCreate} onOpenChange={setShowCreate} title="Nouvelle fiche de placement" size="lg">
          <CreateFicheForm onCreated={() => setShowCreate(false)} productModels={productModels} />
        </Dialog>
        <NouvelOrdreRegroupeDialog open={showRegroupe} onOpenChange={setShowRegroupe} semiFinis={semiFinis} />
      </div>
    </SizesContext.Provider>
  );
}

/* ============================================================
   Champ générique + recherche simple (ODF / client)
============================================================ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-foreground-muted">{label}</label>
      {children}
    </div>
  );
}

function SearchPicker<T>({
  placeholder,
  search,
  renderOption,
  onSelect,
  displayValue,
}: {
  placeholder: string;
  search: (q: string) => Promise<T[]>;
  renderOption: (item: T) => string;
  onSelect: (item: T) => void;
  displayValue?: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [open, setOpen] = useState(false);

  async function handleChange(v: string) {
    setQuery(v);
    if (v.trim().length < 1) {
      setOptions([]);
      return;
    }
    const res = await search(v);
    setOptions(res);
    setOpen(true);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
        <Search className="h-3.5 w-3.5 text-foreground-muted" />
        <input
          value={query || displayValue || ""}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-foreground outline-none"
        />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onSelect(o);
                setQuery(renderOption(o));
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
            >
              {renderOption(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Grille de tailles du référentiel, partagée par l'écran. En contexte plutôt
 * qu'en prop : RepartitionFields est appelée à trois endroits imbriqués
 * différemment, et la prop n'aurait fait que traverser des composants qui
 * n'en font rien.
 */
const SizesContext = createContext<Size[]>([]);

/**
 * Quantités par taille. Les champs sont nommés d'après la CLÉ du référentiel
 * (« Homme/M »), lue telle quelle côté serveur : c'est cette clé qui relie la
 * répartition d'un tracé aux quantités demandées de l'ODF, rapprochement dont
 * dépend la validation (lot 2). Même gabarit de champ (boîte `w-20`) que le
 * dispatching des tailles de l'ODF (production-order-lines.tsx), pour que les
 * deux écrans se lisent de la même façon.
 *
 * `readOnly` bascule vers un simple affichage (pas de `<input>`, rien à
 * soumettre) : sert au dispatching total de la fiche, calculé depuis les
 * tracés plutôt que saisi (voir `repartitionDepuisTraces`).
 */
function RepartitionFields({
  prefix,
  initial,
  readOnly,
}: {
  prefix: string;
  initial?: RepartitionTailles;
  readOnly?: boolean;
}) {
  const sizes = useContext(SizesContext);
  const groupes = [...new Set(sizes.map((t) => t.groupe))];

  if (sizes.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-2 text-xs text-foreground-muted">
        Aucune taille active : alimentez le référentiel dans Paramètres &gt; Couleurs et tailles.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groupes.map((groupe) => (
        <div key={groupe}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{groupe}</p>
          <div className="flex flex-wrap gap-2">
            {sizes
              .filter((t) => t.groupe === groupe)
              .map((t) => {
                const valeur = initial?.[t.cle] ?? 0;
                return (
                  <div
                    key={t.cle}
                    className={`flex w-20 flex-col gap-1 rounded-md border p-1.5 ${
                      valeur > 0 ? "border-brand bg-brand-soft/40" : "border-border"
                    }`}
                  >
                    <span className="text-center text-[11px] font-medium text-foreground">{t.libelle}</span>
                    {readOnly ? (
                      <p className="w-full p-1 text-center text-xs text-foreground">{valeur || 0}</p>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        name={`${prefix}_${t.cle}`}
                        defaultValue={initial?.[t.cle] ?? ""}
                        className="w-full rounded border border-border bg-surface p-1 text-center text-xs outline-none focus:ring-2 focus:ring-brand/30"
                      />
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Cadre 1/3 : choix du modèle d'article, qui pilote désignation, tissu,
 * grammage et laize (hérités du textile principal du modèle, lot C1) au lieu
 * de les faire retaper. Tant qu'aucun modèle n'est choisi, la fiche reste
 * une demande libre (convention existante : aucun champ obligatoire) et ces
 * trois champs restent des zones de texte libre. `onSizesChange` fait
 * remonter les tailles proposables (product_model_sizes) pour que le
 * formulaire appelant restreigne RepartitionFields au lieu des huit tailles
 * du référentiel entier.
 */
function ProductModelFields({
  productModels,
  initialModelId,
  disabled,
  onSizesChange,
  initialTissu,
  initialGrammage,
  initialLaize,
}: {
  productModels: ProductModelOption[];
  initialModelId: string | null;
  disabled?: boolean;
  onSizesChange: (sizes: Size[]) => void;
  initialTissu?: string | null;
  initialGrammage?: number | null;
  initialLaize?: number | null;
}) {
  const allSizes = useContext(SizesContext);
  const [modelId, setModelId] = useState(initialModelId);
  const selected = productModels.find((m) => m.id === modelId) ?? null;

  // Au chargement d'une fiche qui porte déjà un modèle, restreint tout de
  // suite les tailles affichées — sans ça RepartitionFields resterait sur
  // les huit tailles du référentiel entier jusqu'au premier changement de
  // modèle par l'utilisateur.
  useEffect(() => {
    if (initialModelId) sizesForProductModel(initialModelId).then(onSizesChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(id: string) {
    const next = id || null;
    setModelId(next);
    if (!next) {
      onSizesChange(allSizes);
      return;
    }
    sizesForProductModel(next).then(onSizesChange);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Modèle d'article">
          <select
            name="product_model_id"
            defaultValue={initialModelId ?? ""}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
          >
            <option value="">— Aucun (demande libre) —</option>
            {productModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {modelId ? (
          <>
            <Field label="Tissu (hérité du modèle)">
              <p className="rounded-md border border-dashed border-border bg-surface-muted px-2.5 py-2 text-sm text-foreground-muted">
                {selected?.textile?.nom ?? "Aucun textile rattaché à ce modèle"}
              </p>
            </Field>
            <Field label="Grammage (g/m²)">
              <p className="rounded-md border border-dashed border-border bg-surface-muted px-2.5 py-2 text-sm text-foreground-muted">
                {selected?.textile?.grammage ?? "—"}
              </p>
            </Field>
            <Field label="Laize utile (cm)">
              <p className="rounded-md border border-dashed border-border bg-surface-muted px-2.5 py-2 text-sm text-foreground-muted">
                Selon le rouleau
              </p>
            </Field>
          </>
        ) : (
          <>
            <Field label="Tissu">
              <input
                name="tissu_type"
                defaultValue={initialTissu ?? ""}
                disabled={disabled}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
              />
            </Field>
            <Field label="Grammage (g/m²)">
              <input
                type="number"
                name="grammage"
                defaultValue={initialGrammage ?? ""}
                disabled={disabled}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
              />
            </Field>
            <Field label="Laize utile (cm)">
              <input
                type="number"
                name="laize_utile_cm"
                defaultValue={initialLaize ?? ""}
                disabled={disabled}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
              />
            </Field>
          </>
        )}
      </div>
    </>
  );
}

/* ============================================================
   Création d'une fiche
============================================================ */

function CreateFicheForm({
  onCreated,
  productModels,
}: {
  onCreated: () => void;
  productModels: ProductModelOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [clientCode, setClientCode] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    if (lineId) fd.set("production_order_line_id", lineId);
    if (clientCode) fd.set("client_code", clientCode);
    startTransition(async () => {
      const res = await createFiche(fd);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      onCreated();
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}
      <p className="text-xs text-foreground-muted">
        Le n° OT est généré automatiquement. Aucun champ n&apos;est obligatoire — une fiche peut être créée vide, en
        pure demande, et complétée ensuite (par le commercial ou par la PAO).
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Client">
          <SearchPicker
            placeholder="Rechercher un client Sage…"
            search={searchClient}
            renderOption={(c: { code: string; name: string }) => c.name}
            onSelect={(c) => setClientCode(c.code)}
          />
          <input type="hidden" name="client_libelle" value="" />
        </Field>
        <Field label="Lier à un article d'ODF (optionnel)">
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchPicker
                placeholder="Rechercher une référence ODF…"
                search={searchOdfLines}
                renderOption={(o: { id: string; reference: string }) => o.reference}
                onSelect={(o) => setLineId(o.id ?? null)}
              />
            </div>
            <QrScannerButton
              onScanned={async (reference) => {
                const results = await searchOdfLines(reference);
                if (results[0]) setLineId(results[0].id ?? null);
              }}
            />
          </div>
        </Field>
      </div>

      <ProductModelFields productModels={productModels} initialModelId={null} onSizesChange={() => {}} />

      <Field label="Quantité totale à produire">
        <input type="number" min={0} name="quantite_totale" className="w-40 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
      </Field>
      <p className="text-xs text-foreground-muted">
        Le dispatching des tailles se calcule automatiquement à partir des tracés, une fois la fiche créée.
      </p>

      <Field label="Couleur">
        <input name="couleur" className="w-64 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
      </Field>

      <Field label="Contraintes particulières">
        <input name="contraintes" className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
      </Field>

      <Field label="Observations / instructions particulières">
        <textarea name="observations" rows={2} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Créer la fiche
        </Button>
      </div>
    </form>
  );
}

/* ============================================================
   Fiche détail
============================================================ */

export function FicheDetailContent({
  fiche,
  referenceOptions,
  permissions,
  highlightTraceId,
  sizes = [],
  productModels = [],
}: {
  fiche: FichePlacement;
  referenceOptions: ReferenceOption[];
  permissions: Permissions;
  highlightTraceId?: string | null;
  /** Grille de tailles active (Paramètres > Couleurs et tailles). */
  sizes?: Size[];
  /** Modèles actifs, pour le cadre 1 (lot C2). */
  productModels?: ProductModelOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = fiche.statut === "bon_pour_coupe" || fiche.statut === "archive";
  const cadreFormRef = useRef<HTMLFormElement>(null);
  const [cadreSizes, setCadreSizes] = useState<Size[]>(sizes);
  const [openTraceId, setOpenTraceId] = useState<string | null>(highlightTraceId ?? null);
  const dispatchingParTaille = repartitionDepuisTraces(fiche.traces);
  const dispatchingTotal = repartitionTotal(dispatchingParTaille);
  const dispatchingEcart = dispatchingTotal - (fiche.quantiteTotale ?? 0);
  const openTrace = fiche.traces.find((t) => t.id === openTraceId) ?? null;

  function refresh() {
    router.refresh();
  }

  function runAction(action: () => Promise<{ error?: string } | undefined>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res && "error" in res && res.error) setError(res.error);
      else refresh();
    });
  }

  /**
   * Liaison à un article d'ODF : un écart de quantité/dispatching entre la
   * fiche et l'article ne bloque pas la liaison (même convention que
   * `generateFicheFromLine` côté ODF, décision Ayman 16/09) — juste un
   * avertissement, avec confirmation explicite pour lier quand même.
   */
  function linkToLine(lineId: string, force = false) {
    setError(null);
    startTransition(async () => {
      const res = await linkLine(fiche.id, lineId, force);
      if ("warning" in res && res.warning) {
        toast.warning(res.warning, { action: { label: "Lier quand même", onClick: () => linkToLine(lineId, true) } });
        return;
      }
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      refresh();
    });
  }

  function handleSaveCadres(e: React.FormEvent) {
    e.preventDefault();
    if (!cadreFormRef.current) return;
    const fd = new FormData(cadreFormRef.current);
    runAction(() => updateFiche(fiche.id, fd));
  }

  // Suppression définitive : la fiche cesse d'exister, donc pas de refresh()
  // classique ici — la page dédiée (/atelier/patronnage/[id]) tomberait sur
  // un 404 en tentant de la recharger. On repart vers la liste à la place.
  function handleDelete() {
    if (!confirm("Supprimer définitivement cette fiche ? Cette action est irréversible.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteFicheDefinitively(fiche.id);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.push("/atelier/patronnage");
    });
  }

  // La grille de tailles se restreint à celles du modèle choisi (cadreSizes)
  // partout dans la fiche — cadre "Demande" ET tracés : sans ça, ajouter un
  // tracé proposait les huit tailles du référentiel entier au lieu des
  // seules tailles du modèle (product_model_sizes), comme sur l'ODF.
  return (
    <SizesContext.Provider value={cadreSizes}>
      <div className="space-y-5">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        {/* En-tête : statut + actions de cycle de vie */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-4 py-3">
          <div className="flex items-center gap-3">
            <Badge tone={STATUT_TONE[fiche.statut]} dot>
              {STATUT_LABELS[fiche.statut]}
            </Badge>
            <span className="text-xs text-foreground-muted">Émise le {formatDate(fiche.dateEmission)}</span>
            <span className="text-xs text-foreground-muted">· Statut calculé d&apos;après les tracés : chacun se valide un par un.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {fiche.statut !== "archive" && permissions.canArchive && (
              <Button size="sm" variant="ghost" loading={pending} onClick={() => runAction(() => archiveFiche(fiche.id))}>
                <Archive className="h-3.5 w-3.5" /> Archiver
              </Button>
            )}
            {fiche.statut === "archive" && permissions.canArchive && (
              <Button size="sm" variant="ghost" loading={pending} onClick={() => runAction(() => unarchiveFiche(fiche.id))}>
                <ArchiveRestore className="h-3.5 w-3.5" /> Désarchiver
              </Button>
            )}
            {permissions.canDelete && !fiche.valideLe && !fiche.premiereLiaisonLe && (
              <Button
                size="sm"
                variant="ghost"
                loading={pending}
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            )}
          </div>
        </div>

        {locked && (
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {fiche.statut === "archive"
              ? "Fiche archivée — aucune modification des cadres ni des tracés tant qu'elle n'est pas désarchivée."
              : "Un tracé est validé : les cadres de la fiche sont figés. Les tracés restent gérés un par un (ajout, validation, modification motivée, annulation)."}
          </div>
        )}

        {fiche.semiFini ? (
          <ArticlesRegroupesCard fiche={fiche} canModify={permissions.canModify && fiche.statut !== "archive"} />
        ) : (
          <>
        {/* Lien ODF (article précis, migration 0037) */}
        <Card>
          <CardHeader title="Article d'ODF lié" description={fiche.premiereLiaisonLe ? `Première liaison le ${formatDate(fiche.premiereLiaisonLe)}` : "Optionnel"} />
          <CardBody className="space-y-3">
            {!locked && permissions.canModify ? (
              fiche.lineId ? (
                // Liée : on ne laisse plus rechercher un autre article
                // par-dessus (linkLine le refuse désormais tant que celui-ci
                // n'est pas délié — évite qu'une fiche glisse silencieusement
                // d'un article à l'autre). Correction : délier explicitement
                // d'abord.
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-foreground">{fiche.odfReference}</p>
                  <Button size="sm" variant="ghost" loading={pending} onClick={() => runAction(() => linkLine(fiche.id, null))}>
                    Délier
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SearchPicker
                      placeholder="Rechercher une référence ODF…"
                      search={searchOdfLines}
                      renderOption={(o: { id: string; reference: string }) => o.reference}
                      onSelect={(o) => o.id && linkToLine(o.id)}
                    />
                  </div>
                  <QrScannerButton
                    onScanned={async (reference) => {
                      const results = await searchOdfLines(reference);
                      if (results[0]?.id) linkToLine(results[0].id);
                    }}
                  />
                </div>
              )
            ) : (
              <p className="text-sm text-foreground">{fiche.odfReference ?? "Aucun ODF lié"}</p>
            )}

            {/*
              Dispatching demandé par l'ODF, pour que l'infographiste/PAO l'ait
              sous les yeux sans ouvrir l'ODF à côté — donnée déjà copiée
              depuis production_order_sizes au moment de la liaison
              (applyLineToFiche, fiches-actions.ts), affichée ici pour la
              première fois. Visible même verrouillée/lecture seule : c'est
              justement là que ça sert le plus (tracé en cours, fiche figée).
            */}
            {fiche.lineId && Object.keys(fiche.repartitionTailles ?? {}).length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-foreground-muted">Dispatching demandé par l&apos;ODF</p>
                <RepartitionFields prefix="odf_demande" initial={fiche.repartitionTailles} readOnly />
              </div>
            )}
          </CardBody>
        </Card>
          </>
        )}

        {/* Cadres 1-4 */}
        <Card>
          <CardHeader title="Demande" description="Cadres 1 à 4 — aucun champ n'est obligatoire" />
          <CardBody>
            <form ref={cadreFormRef} onSubmit={handleSaveCadres} className="space-y-4">
              <ProductModelFields
                productModels={productModels}
                initialModelId={fiche.productModelId}
                disabled={locked || !permissions.canModify}
                onSizesChange={setCadreSizes}
                initialTissu={fiche.tissuType}
                initialGrammage={fiche.grammage}
                initialLaize={fiche.laizeUtileCm}
              />

              <Field label="Quantité totale à produire">
                <input
                  type="number"
                  name="quantite_totale"
                  defaultValue={fiche.quantiteTotale ?? ""}
                  disabled={locked || !permissions.canModify}
                  className="w-40 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
                />
              </Field>

              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-foreground-muted">
                    Dispatching total (calculé depuis les tracés)
                  </p>
                  <p className="text-xs">
                    <span className="text-foreground-muted">Réparti </span>
                    <span
                      className={
                        fiche.quantiteTotale == null || dispatchingTotal === fiche.quantiteTotale
                          ? "font-semibold text-success"
                          : "font-semibold text-warning"
                      }
                    >
                      {dispatchingTotal}
                    </span>
                    {fiche.quantiteTotale != null && (
                      <>
                        <span className="text-foreground-muted"> / {fiche.quantiteTotale}</span>
                        {dispatchingEcart !== 0 && (
                          <span className="text-warning">
                            {" "}
                            — {dispatchingEcart > 0 ? `${dispatchingEcart} en trop` : `il manque ${-dispatchingEcart}`}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <RepartitionFields prefix="taille" initial={dispatchingParTaille} readOnly />
              </div>

              <Field label="Couleur">
                <input name="couleur" defaultValue={fiche.couleur ?? ""} disabled={locked || !permissions.canModify} className="w-64 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60" />
              </Field>

              <Field label="Contraintes particulières">
                <input name="contraintes" defaultValue={fiche.contraintes ?? ""} disabled={locked || !permissions.canModify} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60" />
              </Field>
              <Field label="Observations / instructions particulières">
                <textarea name="observations" rows={2} defaultValue={fiche.observations ?? ""} disabled={locked || !permissions.canModify} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60" />
              </Field>

              {!locked && permissions.canModify && (
                <div className="flex justify-end">
                  <Button type="submit" size="sm" loading={pending}>
                    Enregistrer
                  </Button>
                </div>
              )}
            </form>
          </CardBody>
        </Card>

        {/* Tracés — liste, détail en fenêtre interne au clic sur la ligne */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Tracés ({fiche.traces.length})</h3>
            <div className="flex gap-2">
              {fiche.statut !== "archive" && permissions.canAddTrace && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  onClick={() => runAction(() => addTrace(fiche.id, new FormData()))}
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter un tracé
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardBody className="p-0">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Référence</Th>
                    <Th>Statut</Th>
                    <Th align="center">Plis</Th>
                    <Th align="center">Total pièces</Th>
                    <Th>Fichier</Th>
                    <Th align="right">Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {fiche.traces.map((trace) => (
                    <TraceRow
                      key={trace.id}
                      trace={trace}
                      highlighted={trace.id === highlightTraceId}
                      onOpen={() => setOpenTraceId(trace.id)}
                    />
                  ))}
                  {fiche.traces.length === 0 && <EmptyRow colSpan={6}>Aucun tracé déposé pour l&apos;instant.</EmptyRow>}
                </Tbody>
              </Table>
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog
        open={!!openTrace}
        onOpenChange={(v) => !v && setOpenTraceId(null)}
        title={openTrace?.reference}
        size="lg"
      >
        {openTrace && (
          <TraceDetailBody
            fiche={fiche}
            trace={openTrace}
            archived={fiche.statut === "archive"}
            canModify={permissions.canModifyTrace}
            canValidate={permissions.canValidate}
            canUnlock={permissions.canUnlock}
            canLearn={permissions.canLearn}
            referenceOptions={referenceOptions}
            onChanged={refresh}
          />
        )}
      </Dialog>
    </SizesContext.Provider>
  );
}

/* ============================================================
   Tracés — ligne de tableau (liste), détail en fenêtre interne
============================================================ */

/** Résumé d'une ligne — l'essentiel visible sans ouvrir le détail. */
function TraceRow({
  trace,
  highlighted,
  onOpen,
}: {
  trace: TracePlacement;
  highlighted?: boolean;
  onOpen: () => void;
}) {
  const totalCouche = repartitionTotal(trace.repartitionParCouche);
  const totalTrace = trace.nbPlis ? totalCouche * trace.nbPlis : null;
  const a = trace.analyse;

  return (
    <tr
      id={`trace-${trace.id}`}
      onClick={onOpen}
      className={cn("cursor-pointer transition-colors hover:bg-surface-muted/40", highlighted && "bg-brand-soft/40")}
    >
      <Td className="font-medium text-foreground">
        {trace.reference}
        {trace.estCorrectif && <span className="ml-1.5 text-xs text-warning">(rattrapage)</span>}
      </Td>
      <Td>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUT_TRACE_TONES[trace.statut]} dot>
            {STATUT_TRACE_LABELS[trace.statut]}
          </Badge>
          {trace.statut === "en_preparation" &&
            (a ? (
              a.reconnaissanceComplete ? (
                <span className="text-xs text-success">reconnu</span>
              ) : (
                <span className="text-xs text-danger">à vérifier</span>
              )
            ) : (
              <span className="text-xs text-foreground-muted">{trace.fichierNom ? "déposé" : "en attente de dépôt"}</span>
            ))}
        </span>
      </Td>
      <Td align="center">{trace.nbPlis ?? "—"}</Td>
      <Td align="center">{totalTrace ?? "—"}</Td>
      <Td>{trace.fichierNom ?? <span className="text-foreground-muted">—</span>}</Td>
      <Td align="right">
        <Eye className="ml-auto h-3.5 w-3.5 text-foreground-muted" />
      </Td>
    </tr>
  );
}

/** Détail complet d'un tracé, ouvert dans la fenêtre interne (Dialog) déclenchée par sa ligne. */
function TraceDetailBody({
  fiche,
  trace,
  archived,
  canModify,
  canValidate,
  canUnlock,
  canLearn,
  onChanged,
}: {
  fiche: FichePlacement;
  trace: TracePlacement;
  archived: boolean;
  canModify: boolean;
  canValidate: boolean;
  canUnlock: boolean;
  canLearn: boolean;
  referenceOptions: ReferenceOption[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Validation : le motif n'est demandé que si la base signale un surplus (aucune tolérance).
  const [motifRequis, setMotifRequis] = useState(false);
  const [motifValidation, setMotifValidation] = useState("");
  // Modification d'un tracé validé (droit « déverrouiller ») et annulation : motif obligatoire.
  const [modeModif, setModeModif] = useState(false);
  const [showAnnul, setShowAnnul] = useState(false);
  const [motifAnnul, setMotifAnnul] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const matelasFormRef = useRef<HTMLFormElement>(null);

  function run(action: () => Promise<{ error?: string } | { reconnaissanceComplete?: boolean } | undefined>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res && "error" in res && res.error) setError(res.error);
      else onChanged();
    });
  }

  function valider() {
    setError(null);
    startTransition(async () => {
      const res = await validerTrace(trace.id, fiche.id, motifRequis ? motifValidation : undefined);
      if ("error" in res && res.error) {
        setError(res.error);
        if (res.motifRequis) setMotifRequis(true);
      } else onChanged();
    });
  }

  // TR-1a : seul un tracé en préparation (ou prévisionnel) se modifie
  // directement ; un tracé validé se modifie avec un motif (droit
  // « déverrouiller »), un tracé en coupe, terminé ou annulé est figé.
  const enPreparation = trace.statut === "en_preparation" || trace.statut === "previsionnel";
  const effectiveLocked = archived || !enPreparation;
  const champsModifiables = (!effectiveLocked && canModify) || modeModif;
  const peutAnnuler = !archived && (trace.statut === "bon_pour_coupe" ? canUnlock : enPreparation && canModify);

  function handleUpload() {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    // Vide le champ : sans cela, re-choisir le MÊME fichier (après une erreur,
    // par exemple) ne déclenche aucun événement et « rien ne se passe ».
    if (input) input.value = "";
    run(() => uploadTraceDxf(trace.id, fiche.id, fd));
  }

  function handleSaveMatelas(e: React.FormEvent) {
    e.preventDefault();
    if (!matelasFormRef.current) return;
    const fd = new FormData(matelasFormRef.current);
    if (modeModif) {
      run(async () => {
        const res = await modifierTraceValide(trace.id, fiche.id, fd);
        if (!res.error) setModeModif(false);
        return res;
      });
    } else run(() => updateTrace(trace.id, fiche.id, fd));
  }

  const totalCouche = repartitionTotal(trace.repartitionParCouche);
  const totalTrace = trace.nbPlis ? totalCouche * trace.nbPlis : null;
  const a = trace.analyse;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUT_TRACE_TONES[trace.statut]} dot>
              {STATUT_TRACE_LABELS[trace.statut]}
            </Badge>
            {trace.estCorrectif && <Badge tone="warning">Rattrapage</Badge>}
            {trace.valideLe && <span className="text-xs text-foreground-muted">validé le {formatDateTime(trace.valideLe)}</span>}
            {trace.modifieValideLe && <span className="text-xs text-foreground-muted">· modifié le {formatDateTime(trace.modifieValideLe)}</span>}
            {trace.demarreLe && <span className="text-xs text-foreground-muted">· coupe démarrée le {formatDateTime(trace.demarreLe)}</span>}
            {trace.termineLe && <span className="text-xs text-foreground-muted">· matelas clôturé le {formatDateTime(trace.termineLe)}</span>}
          </span>
          {trace.estCorrectif && trace.justification && <p className="text-xs text-foreground-muted">Rattrapage : {trace.justification}</p>}
          {trace.surplusValide && (
            <p className="text-xs text-warning">
              Surplus accepté :{" "}
              {Object.entries(trace.surplusValide)
                .map(([t, n]) => `+${n} ${t.split("/").pop()}`)
                .join(", ")}
              {trace.motifValidation ? ` — ${trace.motifValidation}` : ""}
            </p>
          )}
          {trace.statut === "annule" && (
            <p className="text-xs text-danger">
              Annulé le {formatDateTime(trace.annuleLe)} : {trace.motifAnnulation}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!effectiveLocked && canModify && (
            <button
              onClick={() => {
                if (confirm("Retirer ce tracé de la fiche ?")) run(() => deleteTrace(trace.id, fiche.id));
              }}
              className="text-foreground-muted hover:text-danger"
              aria-label="Retirer ce tracé"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Actions de statut */}
      {!archived && (enPreparation ? canValidate || peutAnnuler : trace.statut === "bon_pour_coupe" && canUnlock) && (
        <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <div className="flex flex-wrap gap-2">
            {enPreparation && canValidate && !motifRequis && (
              <Button size="sm" loading={pending} onClick={valider}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Valider — Bon pour coupe
              </Button>
            )}
            {trace.statut === "bon_pour_coupe" && canUnlock && !modeModif && (
              <Button size="sm" variant="secondary" onClick={() => setModeModif(true)} disabled={pending}>
                Modifier (motif)
              </Button>
            )}
            {peutAnnuler && !showAnnul && (
              <Button size="sm" variant="ghost" onClick={() => setShowAnnul(true)} disabled={pending}>
                <XCircle className="h-3.5 w-3.5" /> Annuler le tracé
              </Button>
            )}
          </div>
          {motifRequis && (
            <div className="space-y-2">
              <p className="text-xs text-warning">Ce tracé crée un surplus par rapport à la demande : indiquez pourquoi (aucune tolérance).</p>
              <textarea
                autoFocus
                value={motifValidation}
                onChange={(e) => setMotifValidation(e.target.value)}
                placeholder="Motif du surplus (obligatoire)"
                rows={2}
                className="w-full rounded-md border border-border bg-surface p-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-brand/30"
              />
              <div className="flex gap-1.5">
                <Button size="sm" loading={pending} disabled={!motifValidation.trim()} onClick={valider}>
                  Valider avec ce motif
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMotifRequis(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
          {modeModif && (
            <p className="text-xs text-foreground-muted">
              Modifiez les plis, la répartition ou le matelas ci-dessous, indiquez le motif, puis enregistrez : le tracé reste « Bon pour coupe ».
            </p>
          )}
          {showAnnul && (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={motifAnnul}
                onChange={(e) => setMotifAnnul(e.target.value)}
                placeholder="Motif de l'annulation (obligatoire)"
                rows={2}
                className="w-full rounded-md border border-border bg-surface p-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-brand/30"
              />
              <div className="flex gap-1.5">
                <Button size="sm" variant="danger" loading={pending} disabled={!motifAnnul.trim()} onClick={() => run(() => annulerTrace(trace.id, fiche.id, motifAnnul))}>
                  Confirmer l&apos;annulation
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAnnul(false)}>
                  Retour
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        <form ref={matelasFormRef} onSubmit={handleSaveMatelas} className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Référence patron">
              <input name="reference_patron" defaultValue={trace.referencePatron ?? ""} disabled={effectiveLocked || !canModify} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
            <Field label="Longueur matelas (cm)">
              <input type="number" step="0.1" name="longueur_matelas_cm" defaultValue={trace.longueurMatelasCm ?? ""} disabled={!champsModifiables} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
            <Field label="Largeur matelas (cm)">
              <input type="number" name="largeur_matelas_cm" defaultValue={trace.largeurMatelasCm ?? ""} disabled={!champsModifiables} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
            <Field label="Nombre de plis">
              <input type="number" name={fiche.semiFini ? undefined : "nb_plis"} defaultValue={trace.nbPlis ?? ""} disabled={!champsModifiables || !!fiche.semiFini} title={fiche.semiFini ? "Somme des couches par article" : undefined} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
          </div>
          <Field label={`Répartition par couche (total/couche ${totalCouche}${totalTrace !== null ? ` · théorique tracé ${totalTrace}` : ""})`}>
            <fieldset disabled={!champsModifiables}>
              <RepartitionFields prefix="couche" initial={trace.repartitionParCouche} />
            </fieldset>
          </Field>
          {modeModif && (
            <Field label="Motif de la modification (obligatoire)">
              <textarea
                name="motif"
                required
                rows={2}
                className="w-full rounded-md border border-border bg-surface p-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-brand/30"
              />
            </Field>
          )}
          {champsModifiables && (
            <div className="flex justify-end gap-2">
              {modeModif && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setModeModif(false)}>
                  Abandonner
                </Button>
              )}
              <Button type="submit" size="sm" variant="secondary" loading={pending}>
                {modeModif ? "Enregistrer la modification" : "Enregistrer"}
              </Button>
            </div>
          )}
        </form>

        {fiche.semiFini && <CouchesEditor fiche={fiche} trace={trace} editable={!effectiveLocked && canModify} onChanged={onChanged} />}

        <div className="rounded-md border border-dashed border-border bg-surface-muted p-3">
          <input ref={fileInputRef} type="file" accept=".dxf" onChange={handleUpload} className="hidden" />
          {trace.fichierNom ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-foreground">
                <p>{trace.fichierNom}</p>
                <p className="text-xs text-foreground-muted">déposé le {formatDateTime(trace.chargeLe)}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <TraceDownloadMenu traceId={trace.id} marquageDisponible={!!a} />
                {!effectiveLocked && canModify && (
                  <>
                    <Button size="sm" variant="secondary" type="button" onClick={() => fileInputRef.current?.click()} loading={pending}>
                      Remplacer
                    </Button>
                    <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => removeTraceDxf(trace.id, fiche.id))}>
                      Retirer
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : !effectiveLocked && canModify ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-foreground-muted">Aucun fichier déposé (DXF Modaris).</p>
              <Button size="sm" type="button" onClick={() => fileInputRef.current?.click()} loading={pending}>
                <Upload className="h-3.5 w-3.5" /> Choisir un fichier DXF
              </Button>
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">Aucun fichier déposé.</p>
          )}
        </div>

        {a && (
          <div className="space-y-2">
            <div
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                a.reconnaissanceComplete ? "border-success/30 bg-success-soft text-foreground" : "border-danger/30 bg-danger-soft text-foreground"
              )}
            >
              {a.reconnaissanceComplete ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
              )}
              {a.nbPiecesDetectees} pièce(s) détectée(s) — {a.reconnaissanceComplete ? "100% reconnues" : `${a.piecesNonReconnues.length} non reconnue(s)`}
            </div>

            {!effectiveLocked && canModify && (
              <SelecteurEchelle
                traceId={trace.id}
                ficheId={fiche.id}
                facteurApplique={a.facteurEchelle}
                onChanged={onChanged}
              />
            )}

            {a.alerteEchelle && (
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Correction d&apos;échelle fichier appliquée : ×{a.facteurEchelle}
              </div>
            )}
            {a.alerteMiroir && (
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Pièce(s) reconnue(s) en miroir
              </div>
            )}

            <TracePiecesPanel
              key={a.analyseeLe}
              traceId={trace.id}
              ficheId={fiche.id}
              complete={a.reconnaissanceComplete}
              canLearn={canLearn && !effectiveLocked && canModify}
              onChanged={onChanged}
            />
          </div>
        )}

        {trace.rendement && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground-muted">
              Rendement matière — matelas clôturé le {formatDateTime(trace.rendement.clotureLe)}
            </p>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-muted p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-foreground-muted">Pièces obtenues</p>
                <p className="font-medium text-foreground">{trace.rendement.piecesObtenues}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Tissu engagé (théorique)</p>
                <p className="font-medium text-foreground">
                  {trace.rendement.poidsTissuTheoriqueKg !== null ? `${trace.rendement.poidsTissuTheoriqueKg} kg` : "incomplet"}
                </p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Déchet</p>
                <p className="font-medium text-foreground">{trace.rendement.poidsDechetKg} kg</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Rendement (théorique / estimé)</p>
                <p className="font-medium text-foreground">
                  {trace.rendement.rendementTheoriquePiecesParKg ?? "—"} / {trace.rendement.rendementEstimePiecesParKg ?? "—"} pièces/kg
                </p>
              </div>
            </div>
          </div>
        )}

    </div>
  );
}
