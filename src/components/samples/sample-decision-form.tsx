"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { submitSampleDecision } from "@/lib/actions/samples";
import type { SampleDecision } from "@/lib/types/domain";
import { ThumbsUp, ThumbsDown, Wrench } from "lucide-react";

export function SampleDecisionForm({ sampleId }: { sampleId: string }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  function decide(decision: SampleDecision) {
    startTransition(async () => {
      const res = await submitSampleDecision(sampleId, decision, feedback);
      if (res?.error) toast.error(res.error);
      else toast.success("Décision enregistrée");
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted/50 p-3">
      <p className="text-xs font-medium text-foreground">Votre décision sur cet échantillon</p>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Commentaire (optionnel)"
        rows={2}
        className="w-full rounded-md border border-border bg-surface p-2 text-xs"
      />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="success" onClick={() => decide("valide")} loading={pending}>
          <ThumbsUp className="h-3.5 w-3.5" /> Valider
        </Button>
        <Button size="sm" variant="secondary" onClick={() => decide("a_ajuster")} loading={pending}>
          <Wrench className="h-3.5 w-3.5" /> À ajuster
        </Button>
        <Button size="sm" variant="danger" onClick={() => decide("refuse")} loading={pending}>
          <ThumbsDown className="h-3.5 w-3.5" /> Refuser
        </Button>
      </div>
    </div>
  );
}
