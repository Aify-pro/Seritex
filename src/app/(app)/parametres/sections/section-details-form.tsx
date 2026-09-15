"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateSectionDetails } from "../actions";

export function SectionDetailsForm({
  sectionId,
  name,
  description,
}: {
  sectionId: string;
  name: string;
  description: string | null;
}) {
  const [nameValue, setNameValue] = useState(name);
  const [descriptionValue, setDescriptionValue] = useState(description ?? "");
  const [pending, startTransition] = useTransition();

  const dirty = nameValue !== name || descriptionValue !== (description ?? "");

  function save() {
    if (!nameValue.trim()) {
      toast.error("Le nom de la section est obligatoire");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", nameValue);
      formData.set("description", descriptionValue);
      const res = await updateSectionDetails(sectionId, formData);
      if (res?.error) toast.error(res.error);
      else toast.success("Section mise à jour");
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-[10px] text-foreground-muted">Nom</label>
        <input
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
      <div className="flex-1 min-w-[200px]">
        <label className="mb-1 block text-[10px] text-foreground-muted">Description</label>
        <input
          value={descriptionValue}
          onChange={(e) => setDescriptionValue(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
      {dirty && (
        <Button size="sm" variant="secondary" onClick={save} loading={pending}>
          Enregistrer
        </Button>
      )}
    </div>
  );
}
