"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteSignatory, removeCompanyStamp, saveSignatory, setCompanyStamp, setSignatoryActive } from "./seal-actions";

export type SignatoryRow = {
  user_id: string;
  full_name: string;
  role: string;
  fonction: string | null;
  active: boolean;
  signature_png: string;
};
export type StaffOption = { id: string; full_name: string; role: string };

const imgBox = "flex h-20 w-44 items-center justify-center rounded-md border border-border bg-white p-1";

export function CompanyStampManager({ stampPng }: { stampPng: string | null }) {
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className={imgBox}>
        {stampPng ? (
          // eslint-disable-next-line @next/next/no-img-element -- aperçu d'une image base64 stockée en base
          <img src={`data:image/png;base64,${stampPng}`} alt="Cachet de la société" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-foreground-muted">Aucun cachet</span>
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        action={(formData) =>
          startTransition(async () => {
            const res = await setCompanyStamp(formData);
            if (res.error) toast.error(res.error);
            else {
              toast.success("Cachet enregistré");
              if (fileRef.current) fileRef.current.value = "";
            }
          })
        }
      >
        <div>
          <label htmlFor="stamp-file" className="mb-1 block text-xs font-medium text-foreground">
            {stampPng ? "Remplacer le cachet" : "Téléverser le cachet"} (PNG, fond transparent conseillé)
          </label>
          <input id="stamp-file" ref={fileRef} name="image" type="file" accept="image/png" required className="block text-sm" />
        </div>
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
        {stampPng && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await removeCompanyStamp();
                if (res.error) toast.error(res.error);
                else toast.success("Cachet retiré");
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" /> Retirer
          </Button>
        )}
      </form>
    </div>
  );
}

export function SignatoriesManager({ signatories, staff }: { signatories: SignatoryRow[]; staff: StaffOption[] }) {
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [fonction, setFonction] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const existing = signatories.find((s) => s.user_id === userId);

  function run(fn: () => Promise<{ error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else if (success) toast.success(success);
    });
  }

  return (
    <div className="space-y-4">
      {signatories.length === 0 ? (
        <p className="text-sm text-foreground-muted">Aucune signature enregistrée.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {signatories.map((s) => (
            <li key={s.user_id} className="flex flex-wrap items-center gap-4 px-3 py-2 text-sm">
              <div className={`${imgBox} h-14 w-32`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- aperçu d'une image base64 stockée en base */}
                <img src={`data:image/png;base64,${s.signature_png}`} alt={`Signature de ${s.full_name}`} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="min-w-0">
                <p className={s.active ? "font-medium text-foreground" : "font-medium text-foreground-muted line-through"}>{s.full_name}</p>
                <p className="text-xs text-foreground-muted">{[s.fonction, s.role].filter(Boolean).join(" · ")}</p>
              </div>
              {s.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Désactivée</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setSignatoryActive(s.user_id, !s.active))}>
                  {s.active ? "Désactiver" : "Activer"}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} title="Supprimer la signature" onClick={() => run(() => deleteSignatory(s.user_id), "Signature supprimée")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2"
        action={(formData) =>
          startTransition(async () => {
            const res = await saveSignatory(formData);
            if (res.error) toast.error(res.error);
            else {
              toast.success(existing ? "Signature mise à jour" : "Signature ajoutée");
              setUserId("");
              setFonction("");
              if (fileRef.current) fileRef.current.value = "";
            }
          })
        }
      >
        <div>
          <label htmlFor="sig-user" className="mb-1 block text-xs font-medium text-foreground">
            Compte utilisateur
          </label>
          <select
            id="sig-user"
            name="user_id"
            required
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setFonction(signatories.find((s) => s.user_id === e.target.value)?.fonction ?? "");
            }}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">— Sélectionner —</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.role}){signatories.some((s) => s.user_id === u.id) ? " — a déjà une signature" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sig-fonction" className="mb-1 block text-xs font-medium text-foreground">
            Fonction imprimée sous la signature
          </label>
          <input
            id="sig-fonction"
            name="fonction"
            value={fonction}
            onChange={(e) => setFonction(e.target.value)}
            placeholder="ex. Directeur général"
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="sig-file" className="mb-1 block text-xs font-medium text-foreground">
            Image de la signature (PNG, fond transparent conseillé){existing ? " — laissez vide pour ne changer que la fonction" : ""}
          </label>
          <input id="sig-file" ref={fileRef} name="image" type="file" accept="image/png" required={!existing} className="block text-sm" />
        </div>
        <div>
          <Button type="submit" size="sm" loading={pending} disabled={!userId}>
            {existing ? "Mettre à jour" : "Ajouter la signature"}
          </Button>
        </div>
      </form>
    </div>
  );
}
