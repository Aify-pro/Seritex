"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SampleEditForm } from "@/components/samples/sample-edit-form";
import type { SamplePriority } from "@/lib/types/domain";

export function SampleEditDialog({
  sampleId,
  needDescription,
  quantityRequested,
  priority,
  requestDate,
  dueDate,
  extraInfo,
}: {
  sampleId: string;
  needDescription: string;
  quantityRequested: number;
  priority: SamplePriority;
  requestDate: string;
  dueDate: string | null;
  extraInfo: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Modifier
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Modifier la fiche" size="sm">
        <SampleEditForm
          sampleId={sampleId}
          needDescription={needDescription}
          quantityRequested={quantityRequested}
          priority={priority}
          requestDate={requestDate}
          dueDate={dueDate}
          extraInfo={extraInfo}
          onSaved={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
