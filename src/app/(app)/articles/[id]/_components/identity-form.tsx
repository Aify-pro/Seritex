"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateProductModelIdentity } from "../../actions";

/** Nom et catégorie du modèle — enregistrés ensemble. */
export function IdentityForm({
  productModelId,
  name,
  category,
  editable,
}: {
  productModelId: string;
  name: string;
  category: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateProductModelIdentity(productModelId, formData);
          if (res?.error) toast.error("Enregistrement refusé", { description: res.error });
          else {
            toast.success("Article enregistré");
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-3"
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Nom</span>
        <input
          name="name"
          defaultValue={name}
          required
          disabled={!editable}
          className="h-9 w-64 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Catégorie</span>
        <input
          name="category"
          defaultValue={category ?? ""}
          disabled={!editable}
          className="h-9 w-48 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70"
        />
      </label>
      {editable && (
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
      )}
    </form>
  );
}
