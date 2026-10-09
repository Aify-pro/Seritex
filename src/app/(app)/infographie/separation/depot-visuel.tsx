"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { SeparationCouleurs } from "@/components/separation/separation-couleurs";
import type { Encre } from "@/lib/separation/nuancier";
import type { ParametresSerigraphie } from "@/lib/separation/prix-revient";
import { cn } from "@/lib/utils";

const FORMATS = "image/png,image/jpeg,image/webp,image/svg+xml";

/** Dépôt d'un visuel (glisser-déposer ou choix du fichier), analysé dans le navigateur sans envoi. */
export function DepotVisuel({ encres, parametres }: { encres: Encre[]; parametres: ParametresSerigraphie | null }) {
  const [fichier, setFichier] = useState<File | null>(null);
  const [survol, setSurvol] = useState(false);

  function choisir(f: File | undefined) {
    if (f) setFichier(f);
  }

  return (
    <div className="space-y-5">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSurvol(false);
          choisir(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors",
          survol ? "border-brand bg-brand/5" : "border-border hover:bg-surface-muted",
        )}
      >
        <Upload className="h-6 w-6 text-foreground-muted" />
        <span className="font-medium text-foreground">{fichier ? `${fichier.name} — choisir un autre visuel` : "Glissez un visuel ici ou cliquez pour le choisir"}</span>
        <span className="text-xs text-foreground-muted">PNG, JPEG, WebP ou SVG. Le fichier reste sur votre poste : rien n&apos;est envoyé.</span>
        <input type="file" accept={FORMATS} className="sr-only" onChange={(e) => choisir(e.target.files?.[0])} />
      </label>

      {fichier && <SeparationCouleurs key={`${fichier.name}-${fichier.lastModified}-${fichier.size}`} source={fichier} nom={fichier.name} encres={encres} parametres={parametres} />}
    </div>
  );
}
