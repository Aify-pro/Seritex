"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateMyProfileAction, type ProfileFormState } from "./actions";

const inputClass = "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none ring-brand/30 focus:ring-2";

export function ProfileForm({
  fullName,
  phone,
  jobTitle,
}: {
  fullName: string;
  phone: string | null;
  jobTitle: string | null;
}) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(updateMyProfileAction, {});

  useEffect(() => {
    if (state.success) toast.success("Profil mis à jour");
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="full_name" className="mb-1 block text-xs font-medium text-foreground">
          Nom complet
        </label>
        <input id="full_name" name="full_name" required defaultValue={fullName} autoComplete="name" className={inputClass} />
      </div>
      <div>
        <label htmlFor="phone" className="mb-1 block text-xs font-medium text-foreground">
          Téléphone
        </label>
        <input id="phone" name="phone" type="tel" defaultValue={phone ?? ""} autoComplete="tel" placeholder="+212 6 00 00 00 00" className={inputClass} />
      </div>
      <div>
        <label htmlFor="job_title" className="mb-1 block text-xs font-medium text-foreground">
          Fonction
        </label>
        <input id="job_title" name="job_title" defaultValue={jobTitle ?? ""} autoComplete="organization-title" className={inputClass} />
      </div>
      {state.error && (
        <div role="alert" className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
