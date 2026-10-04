"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { answerConfirmation } from "./actions";

export function ConfirmationForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"choix" | "probleme">("choix");
  const [commentaire, setCommentaire] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);

  function send(reponse: "confirme" | "probleme") {
    startTransition(async () => {
      const res = await answerConfirmation(token, reponse, commentaire);
      setResult(
        res.error
          ? { error: res.error }
          : { ok: reponse === "confirme" ? "Merci, la réception est confirmée." : "Merci, votre signalement a été transmis à notre service livraison." }
      );
    });
  }

  if (result?.ok) return <p className="rounded-md bg-success-soft px-3 py-3 text-sm text-success">{result.ok}</p>;

  return (
    <div className="space-y-3">
      {result?.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{result.error}</p>}
      {mode === "choix" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="md" variant="success" className="h-11 flex-1" loading={pending} onClick={() => send("confirme")}>
            Confirmer la réception
          </Button>
          <Button size="md" variant="secondary" className="h-11 flex-1" onClick={() => setMode("probleme")}>
            Signaler un problème
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Décrivez le problème : pièces manquantes, abîmées, erreur de taille…"
            className="w-full rounded-md border border-border bg-surface p-2 text-sm"
          />
          <Button size="md" variant="danger" className="h-11 w-full" loading={pending} disabled={!commentaire.trim()} onClick={() => send("probleme")}>
            Envoyer le signalement
          </Button>
        </div>
      )}
    </div>
  );
}
