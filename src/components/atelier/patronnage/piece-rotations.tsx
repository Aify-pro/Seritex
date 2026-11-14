"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reglerRotationsPiece } from "@/app/(app)/atelier/patronnage/actions";
import {
  CHOIX_ROTATION,
  CHOIX_SYMETRIE,
  choixDepuisRotations,
  libelleRotations,
  type ChoixRotation,
  type Symetrie,
} from "@/lib/patronnage/rotations";

const champ = "rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground disabled:opacity-60";

/**
 * Rotations autorisées et symétrie d'une pièce, lues par le moteur
 * d'imbrication. Modifiables par qui a le droit « modifier » du patronnage ;
 * en lecture seule pour les autres. Chaque changement est enregistré aussitôt.
 */
export function PieceRotations({
  pieceId,
  rotations,
  symetrie,
  canModify,
}: {
  pieceId: string;
  rotations: number[];
  symetrie: Symetrie;
  canModify: boolean;
}) {
  const [choix, setChoix] = useState<ChoixRotation | null>(choixDepuisRotations(rotations));
  const [sym, setSym] = useState<Symetrie>(symetrie);
  const [pending, startTransition] = useTransition();

  if (!canModify) {
    return (
      <p className="text-foreground-muted">
        Rotation : {libelleRotations(rotations)} · Symétrie : {sym === "paire" ? "paire" : "aucune"}
      </p>
    );
  }

  function enregistrer(nouveauChoix: ChoixRotation | null, nouvelleSym: Symetrie) {
    if (!nouveauChoix) return;
    const precedent = { choix, sym };
    setChoix(nouveauChoix);
    setSym(nouvelleSym);
    const angles = [...CHOIX_ROTATION.find((c) => c.valeur === nouveauChoix)!.angles];
    startTransition(async () => {
      const res = await reglerRotationsPiece({ pieceId, rotations: angles, symetrie: nouvelleSym });
      if (res.error) {
        setChoix(precedent.choix);
        setSym(precedent.sym);
        toast.error(res.error);
      } else {
        toast.success("Réglage de la pièce enregistré");
      }
    });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor={`rot-${pieceId}`}>
        Rotations autorisées
      </label>
      <select
        id={`rot-${pieceId}`}
        title="Rotations autorisées au placement"
        value={choix ?? ""}
        disabled={pending}
        onChange={(e) => enregistrer(e.target.value as ChoixRotation, sym)}
        className={champ}
      >
        {choix === null && <option value="">{libelleRotations(rotations)} (à régler)</option>}
        {CHOIX_ROTATION.map((c) => (
          <option key={c.valeur} value={c.valeur}>
            {c.libelle}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`sym-${pieceId}`}>
        Symétrie
      </label>
      <select
        id={`sym-${pieceId}`}
        title="Symétrie : « paire » = la moitié des exemplaires posée retournée (pièce gauche + pièce droite)"
        value={sym}
        disabled={pending || choix === null}
        onChange={(e) => enregistrer(choix, e.target.value as Symetrie)}
        className={champ}
      >
        {CHOIX_SYMETRIE.map((s) => (
          <option key={s.valeur} value={s.valeur}>
            Symétrie : {s.libelle.toLowerCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
