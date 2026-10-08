"use client";

import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Encre } from "@/lib/separation/nuancier";
import { SeparationCouleurs } from "./separation-couleurs";

/** Ouvre la séparation des couleurs d'un visuel déjà en ligne (URL signée, lisible en CORS). */
export function BoutonSeparation({
  url,
  nom,
  largeurCm,
  encres,
  textileFonce,
}: {
  url: string;
  nom: string;
  largeurCm?: number | null;
  encres?: Encre[];
  textileFonce?: boolean;
}) {
  return (
    <Dialog
      size="lg"
      title="Séparation des couleurs"
      description={nom}
      trigger={
        <Button type="button" variant="secondary" size="sm">
          <Layers className="h-3.5 w-3.5" />
          Séparer les couleurs
        </Button>
      }
    >
      <SeparationCouleurs source={url} nom={nom} largeurCm={largeurCm} encres={encres} textileFonce={textileFonce} />
    </Dialog>
  );
}
