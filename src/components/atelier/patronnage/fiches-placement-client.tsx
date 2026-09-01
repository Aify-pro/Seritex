"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Eye,
  Upload,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
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
import type { FichePlacement, RepartitionTailles, StatutFiche, TracePlacement } from "@/lib/patronnage/types";
import { REPARTITION_TAILLES_KEYS } from "@/lib/patronnage/types";
import {
  createFiche,
  updateFiche,
  linkOdf,
  validateFiche,
  unlockFiche,
  archiveFiche,
  unarchiveFiche,
  deleteFicheDefinitively,
  addTrace,
  updateTrace,
  deleteTrace,
  uploadTraceDxf,
  removeTraceDxf,
  searchOdf,
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

interface Permissions {
  canCreate: boolean;
  canModify: boolean;
  canValidate: boolean;
  canUnlock: boolean;
  canArchive: boolean;
  canDelete: boolean;
}

function repartitionTotal(r: RepartitionTailles): number {
  return Object.values(r).reduce((s, v) => s + (v ?? 0), 0);
}

/* ============================================================
   Écran liste
============================================================ */

export function FichesPlacementClient({
  fiches,
  referenceOptions,
  permissions,
}: {
  fiches: FichePlacement[];
  referenceOptions: ReferenceOption[];
  currentUserRole: string;
  permissions: Permissions;
}) {
  const [filtreStatut, setFiltreStatut] = useState<StatutFiche | "tous">("tous");
  const [showCreate, setShowCreate] = useState(false);
  const [openFicheId, setOpenFicheId] = useState<string | null>(null);

  const filtered = fiches.filter((f) => filtreStatut === "tous" || f.statut === filtreStatut);
  const openFiche = fiches.find((f) => f.id === openFicheId) ?? null;

  return (
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
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> Nouvelle fiche
          </Button>
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
                  <Td>{f.referenceModele ?? <span className="text-foreground-muted">—</span>}</Td>
                  <Td>
                    {f.odfReference ? (
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
                    <Button variant="secondary" size="sm" onClick={() => setOpenFicheId(f.id)}>
                      <Eye className="h-3.5 w-3.5" /> Voir
                    </Button>
                  </Td>
                </Tr>
              ))}
              {filtered.length === 0 && <EmptyRow colSpan={9}>Aucune fiche de placement.</EmptyRow>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate} title="Nouvelle fiche de placement" size="lg">
        <CreateFicheForm onCreated={() => setShowCreate(false)} />
      </Dialog>

      <Dialog
        open={!!openFiche}
        onOpenChange={(v) => !v && setOpenFicheId(null)}
        title={openFiche ? `Fiche ${openFiche.numeroOt}` : ""}
        size="lg"
      >
        {openFiche && (
          <FicheDetailContent fiche={openFiche} referenceOptions={referenceOptions} permissions={permissions} />
        )}
      </Dialog>
    </div>
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

function RepartitionFields({ prefix, initial }: { prefix: string; initial?: RepartitionTailles }) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
      {REPARTITION_TAILLES_KEYS.map((k) => (
        <div key={k}>
          <label className="mb-1 block text-[11px] text-foreground-muted">{k}</label>
          <input
            type="number"
            min={0}
            name={`${prefix}_${k}`}
            defaultValue={initial?.[k] ?? ""}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          />
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Création d'une fiche
============================================================ */

function CreateFicheForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [odfId, setOdfId] = useState<string | null>(null);
  const [clientCode, setClientCode] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    if (odfId) fd.set("odf_id", odfId);
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
        <Field label="Lier à un ODF (optionnel)">
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchPicker
                placeholder="Rechercher une référence ODF…"
                search={searchOdf}
                renderOption={(o: { id: string; reference: string }) => o.reference}
                onSelect={(o) => setOdfId(o.id ?? null)}
              />
            </div>
            <QrScannerButton
              onScanned={async (reference) => {
                const results = await searchOdf(reference);
                if (results[0]) setOdfId(results[0].id ?? null);
              }}
            />
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Désignation article">
          <input name="designation_article" className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
        </Field>
        <Field label="Référence modèle">
          <input name="reference_modele" className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
        </Field>
      </div>

      <Field label="Quantité totale à produire">
        <input type="number" min={0} name="quantite_totale" className="w-40 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
      </Field>

      <Field label="Répartition des tailles">
        <RepartitionFields prefix="taille" />
      </Field>

      <div className="grid grid-cols-4 gap-4">
        <Field label="Tissu">
          <input name="tissu_type" className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
        </Field>
        <Field label="Grammage (g/m²)">
          <input type="number" name="grammage" className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
        </Field>
        <Field label="Couleur">
          <input name="couleur" className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
        </Field>
        <Field label="Laize utile (cm)">
          <input type="number" name="laize_utile_cm" className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground" />
        </Field>
      </div>

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

function FicheDetailContent({
  fiche,
  referenceOptions,
  permissions,
}: {
  fiche: FichePlacement;
  referenceOptions: ReferenceOption[];
  permissions: Permissions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = fiche.statut === "bon_pour_coupe" || fiche.statut === "archive";
  const cadreFormRef = useRef<HTMLFormElement>(null);

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

  function handleSaveCadres(e: React.FormEvent) {
    e.preventDefault();
    if (!cadreFormRef.current) return;
    const fd = new FormData(cadreFormRef.current);
    runAction(() => updateFiche(fiche.id, fd));
  }

  return (
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
          {fiche.valideLe && (
            <span className="text-xs text-foreground-muted">· Validée le {formatDateTime(fiche.valideLe)}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {fiche.statut !== "bon_pour_coupe" && fiche.statut !== "archive" && permissions.canValidate && (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => runAction(() => validateFiche(fiche.id))}>
              <Lock className="h-3.5 w-3.5" /> Valider — bon pour coupe
            </Button>
          )}
          {fiche.statut === "bon_pour_coupe" && permissions.canUnlock && (
            <Button size="sm" variant="secondary" loading={pending} onClick={() => runAction(() => unlockFiche(fiche.id))}>
              <Unlock className="h-3.5 w-3.5" /> Repasser en révision
            </Button>
          )}
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
          {permissions.canDelete && !fiche.valideLe && !fiche.premiereLiaisonOdfLe && (
            <Button
              size="sm"
              variant="ghost"
              loading={pending}
              onClick={() => {
                if (confirm("Supprimer définitivement cette fiche ? Cette action est irréversible."))
                  runAction(() => deleteFicheDefinitively(fiche.id));
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-danger" />
            </Button>
          )}
        </div>
      </div>

      {locked && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" /> Fiche verrouillée — aucune modification des cadres ni des tracés
          tant qu&apos;elle n&apos;est pas repassée en révision.
        </div>
      )}

      {/* Lien ODF */}
      <Card>
        <CardHeader title="Ordre de fabrication lié" description={fiche.premiereLiaisonOdfLe ? `Première liaison le ${formatDate(fiche.premiereLiaisonOdfLe)}` : "Optionnel"} />
        <CardBody>
          {!locked && permissions.canModify ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <SearchPicker
                  placeholder="Rechercher une référence ODF…"
                  search={searchOdf}
                  renderOption={(o: { id: string; reference: string }) => o.reference}
                  onSelect={(o) => runAction(() => linkOdf(fiche.id, o.id ?? null))}
                  displayValue={fiche.odfReference ?? ""}
                />
              </div>
              <QrScannerButton
                onScanned={async (reference) => {
                  const results = await searchOdf(reference);
                  if (results[0]) runAction(() => linkOdf(fiche.id, results[0].id ?? null));
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-foreground">{fiche.odfReference ?? "Aucun ODF lié"}</p>
          )}
        </CardBody>
      </Card>

      {/* Cadres 1-4 */}
      <Card>
        <CardHeader title="Demande" description="Cadres 1 à 4 — aucun champ n'est obligatoire" />
        <CardBody>
          <form ref={cadreFormRef} onSubmit={handleSaveCadres} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Désignation article">
                <input
                  name="designation_article"
                  defaultValue={fiche.designationArticle ?? ""}
                  disabled={locked || !permissions.canModify}
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
                />
              </Field>
              <Field label="Référence modèle">
                <input
                  name="reference_modele"
                  defaultValue={fiche.referenceModele ?? ""}
                  disabled={locked || !permissions.canModify}
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
                />
              </Field>
            </div>

            <Field label="Quantité totale à produire">
              <input
                type="number"
                name="quantite_totale"
                defaultValue={fiche.quantiteTotale ?? ""}
                disabled={locked || !permissions.canModify}
                className="w-40 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60"
              />
            </Field>

            <Field label={`Répartition des tailles (total ${repartitionTotal(fiche.repartitionTailles)})`}>
              <fieldset disabled={locked || !permissions.canModify}>
                <RepartitionFields prefix="taille" initial={fiche.repartitionTailles} />
              </fieldset>
            </Field>

            <div className="grid grid-cols-4 gap-4">
              <Field label="Tissu">
                <input name="tissu_type" defaultValue={fiche.tissuType ?? ""} disabled={locked || !permissions.canModify} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60" />
              </Field>
              <Field label="Grammage (g/m²)">
                <input type="number" name="grammage" defaultValue={fiche.grammage ?? ""} disabled={locked || !permissions.canModify} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60" />
              </Field>
              <Field label="Couleur">
                <input name="couleur" defaultValue={fiche.couleur ?? ""} disabled={locked || !permissions.canModify} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60" />
              </Field>
              <Field label="Laize utile (cm)">
                <input type="number" name="laize_utile_cm" defaultValue={fiche.laizeUtileCm ?? ""} disabled={locked || !permissions.canModify} className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-60" />
              </Field>
            </div>

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

      {/* Tracés */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Tracés ({fiche.traces.length})</h3>
          {!locked && permissions.canModify && (
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

        {fiche.traces.length === 0 && (
          <Card>
            <CardBody className="text-sm text-foreground-muted">Aucun tracé déposé pour l&apos;instant.</CardBody>
          </Card>
        )}

        {fiche.traces.map((trace) => (
          <TraceCard
            key={trace.id}
            fiche={fiche}
            trace={trace}
            locked={locked}
            canModify={permissions.canModify}
            referenceOptions={referenceOptions}
            onChanged={refresh}
          />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Carte d'un tracé
============================================================ */

function TraceCard({
  fiche,
  trace,
  locked,
  canModify,
  onChanged,
}: {
  fiche: FichePlacement;
  trace: TracePlacement;
  locked: boolean;
  canModify: boolean;
  referenceOptions: ReferenceOption[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

  function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    run(() => uploadTraceDxf(trace.id, fiche.id, fd));
  }

  function handleSaveMatelas(e: React.FormEvent) {
    e.preventDefault();
    if (!matelasFormRef.current) return;
    const fd = new FormData(matelasFormRef.current);
    run(() => updateTrace(trace.id, fiche.id, fd));
  }

  const totalCouche = repartitionTotal(trace.repartitionParCouche);
  const totalTrace = trace.nbPlis ? totalCouche * trace.nbPlis : null;
  const a = trace.analyse;

  return (
    <Card>
      <CardHeader
        title={trace.reference}
        action={
          !locked &&
          canModify && (
            <button
              onClick={() => {
                if (confirm("Retirer ce tracé de la fiche ?")) run(() => deleteTrace(trace.id, fiche.id));
              }}
              className="text-foreground-muted hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )
        }
      />
      <CardBody className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        <form ref={matelasFormRef} onSubmit={handleSaveMatelas} className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Référence patron">
              <input name="reference_patron" defaultValue={trace.referencePatron ?? ""} disabled={locked || !canModify} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
            <Field label="Longueur matelas (m)">
              <input type="number" name="longueur_matelas_m" defaultValue={trace.longueurMatelasM ?? ""} disabled={locked || !canModify} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
            <Field label="Largeur matelas (cm)">
              <input type="number" name="largeur_matelas_cm" defaultValue={trace.largeurMatelasCm ?? ""} disabled={locked || !canModify} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
            <Field label="Nombre de plis">
              <input type="number" name="nb_plis" defaultValue={trace.nbPlis ?? ""} disabled={locked || !canModify} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60" />
            </Field>
          </div>
          <Field label={`Répartition par couche (total/couche ${totalCouche}${totalTrace !== null ? ` · théorique tracé ${totalTrace}` : ""})`}>
            <fieldset disabled={locked || !canModify}>
              <RepartitionFields prefix="couche" initial={trace.repartitionParCouche} />
            </fieldset>
          </Field>
          {!locked && canModify && (
            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="secondary" loading={pending}>
                Enregistrer
              </Button>
            </div>
          )}
        </form>

        <div className="rounded-md border border-dashed border-border bg-surface-muted p-3">
          {trace.fichierNom ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-foreground">
                <p>{trace.fichierNom}</p>
                <p className="text-xs text-foreground-muted">déposé le {formatDateTime(trace.chargeLe)}</p>
              </div>
              {!locked && canModify && (
                <div className="flex gap-2">
                  <input ref={fileInputRef} type="file" accept=".dxf" onChange={handleUpload} className="hidden" id={`replace-${trace.id}`} />
                  <label htmlFor={`replace-${trace.id}`}>
                    <Button size="sm" variant="secondary" type="button" onClick={() => fileInputRef.current?.click()} loading={pending}>
                      Remplacer
                    </Button>
                  </label>
                  <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => removeTraceDxf(trace.id, fiche.id))}>
                    Retirer
                  </Button>
                </div>
              )}
            </div>
          ) : !locked && canModify ? (
            <div className="flex items-center gap-3">
              <Upload className="h-4 w-4 text-foreground-muted" />
              <input ref={fileInputRef} type="file" accept=".dxf" onChange={handleUpload} className="text-sm text-foreground-muted" />
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

            {a.patronsReconnus.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border">
                {a.patronsReconnus.map((p) => (
                  <div key={p.patron_id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-foreground">
                      {p.article} · {p.taille} · {p.piece}
                      {p.dont_en_miroir > 0 && <span className="ml-1 text-xs text-warning">(dont {p.dont_en_miroir} en miroir)</span>}
                    </span>
                    <Badge tone="success">×{p.quantite}</Badge>
                  </div>
                ))}
              </div>
            )}

            {a.piecesNonReconnues.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-danger/30">
                {a.piecesNonReconnues.map((p) => (
                  <div key={p.index_piece} className="px-3 py-2 text-sm">
                    <p className="text-foreground">
                      Pièce #{p.index_piece + 1} (calque {p.calque}) — non reconnue
                    </p>
                    {p.meilleur_candidat && (
                      <p className="text-xs text-foreground-muted">
                        Piste la plus proche : {p.meilleur_candidat.article} · {p.meilleur_candidat.taille} ·{" "}
                        {p.meilleur_candidat.piece} ({p.meilleur_score}%)
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
