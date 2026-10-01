"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteStorageTarget, updateStorageTarget } from "@/lib/actions/media";
import type { StorageBackendType } from "@/lib/types/domain";

/** Partie non secrète de la configuration (les mots de passe / clés ne quittent jamais le serveur). */
export interface EditableTarget {
  id: string;
  name: string;
  type: StorageBackendType;
  bucket?: string;
  rootFolderId?: string;
  url?: string;
  username?: string;
  basePath?: string;
}

const inputClass = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

export function TargetActions({ target }: { target: EditableTarget }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const isWebdav = target.type === "nas" || target.type === "local_server";

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Modifier la cible">
        <Pencil className="h-3.5 w-3.5" /> Modifier
      </Button>

      {confirming ? (
        <span className="flex items-center gap-1">
          <Button
            variant="danger"
            size="sm"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteStorageTarget(target.id);
                if (res?.error) toast.error(res.error);
                else toast.success("Cible supprimée");
                setConfirming(false);
              })
            }
          >
            Confirmer
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Annuler
          </Button>
        </span>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label="Supprimer la cible">
          <Trash2 className="h-3.5 w-3.5" /> Supprimer
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen} title={`Modifier « ${target.name} »`} size="md">
        <form
          action={(formData) =>
            startTransition(async () => {
              const res = await updateStorageTarget(formData);
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Cible mise à jour");
                setOpen(false);
              }
            })
          }
          className="space-y-3"
        >
          <input type="hidden" name="id" value={target.id} />
          <Field label="Nom (interne)">
            <input name="name" required defaultValue={target.name} className={inputClass} />
          </Field>

          {target.type === "supabase_storage" && (
            <Field label="Nom du bucket">
              <input name="bucket" required defaultValue={target.bucket} className={inputClass} />
            </Field>
          )}

          {target.type === "google_drive" && (
            <>
              <Field label="Dossier racine (ID Drive)">
                <input name="root_folder_id" required defaultValue={target.rootFolderId} className={inputClass} />
              </Field>
              <Field label="JSON du compte de service (laisser vide pour conserver l'actuel)">
                <textarea name="service_account_json" rows={3} className="w-full rounded-md border border-border bg-surface p-2 font-mono text-xs" />
              </Field>
            </>
          )}

          {isWebdav && (
            <>
              <Field label="URL WebDAV">
                <input name="url" required defaultValue={target.url} className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Identifiant">
                  <input name="username" required defaultValue={target.username} className={inputClass} />
                </Field>
                <Field label="Mot de passe">
                  <input name="password" type="password" placeholder="Inchangé si vide" autoComplete="new-password" className={inputClass} />
                </Field>
              </div>
              <Field label="Dossier de base">
                <input name="base_path" defaultValue={target.basePath} className={inputClass} />
              </Field>
              <p className="text-xs text-foreground-muted">
                Changer l&apos;URL ou le dossier de base ne déplace pas les fichiers déjà copiés : leurs chemins restent ceux enregistrés.
              </p>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              Enregistrer
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
