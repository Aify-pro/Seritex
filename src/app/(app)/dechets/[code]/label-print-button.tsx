"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Printer, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type LabelPrintData = {
  code: string;
  /** URL absolue de la fiche du sac — encodée dans le QR imprimé. */
  url: string;
  /** Déjà formatée (ex. « 18 sept. 2026 »). */
  createdAt: string;
  /** Présent seulement pour un sac scellé (ex. « Scellé — 18,6 kg »). */
  sealedLine: string | null;
};

/**
 * Icône imprimante posée au-dessus du QR du sac : imprime directement
 * l'étiquette sur l'imprimante thermique intégrée de la tablette Sunmi V3H,
 * sans PDF ni fichier à télécharger.
 *
 * On est déjà dans la fiche d'un seul sac : contrairement au menu principal
 * des sacs (planche A4 de plusieurs sacs), il n'y a rien à choisir ici — un
 * clic imprime une étiquette. La planche A4 est traitée ailleurs.
 *
 * Le navigateur ne peut pas savoir si un schéma d'URL personnalisé est géré
 * par une app installée : `sunmiprint://` est intercepté silencieusement par
 * l'app compagnon SunmiPrintBridge côté Android (voir dépôt
 * Aify-pro/sunmi-print-bridge) si elle est installée, sans retour possible
 * en JS en cas d'échec — d'où le message d'aide affiché après l'envoi plutôt
 * qu'une confirmation d'impression réussie.
 */
export function LabelPrintButton({ code, url, createdAt, sealedLine }: LabelPrintData) {
  const [printing, setPrinting] = useState(false);

  function print() {
    setPrinting(true);
    const payload = {
      header: "SERITEX · SAC DE DÉCHETS",
      qrData: url,
      code,
      infoLine: sealedLine ? `Créé le ${createdAt} · ${sealedLine}` : `Créé le ${createdAt}`,
    };
    window.location.href = `sunmiprint://label?data=${encodeURIComponent(base64EncodeUtf8(JSON.stringify(payload)))}`;
    toast.info("Impression envoyée à l'imprimante de la tablette", {
      description: "Rien ne sort ? Vérifiez que l'app SunmiPrintBridge est installée sur ce terminal.",
    });
    window.setTimeout(() => setPrinting(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={print}
      disabled={printing}
      aria-label="Imprimer l'étiquette"
      title="Imprimer l'étiquette"
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-foreground hover:bg-surface-muted",
        printing && "opacity-60"
      )}
    >
      {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
    </button>
  );
}

/** `btoa` n'accepte que du Latin1 : on repasse par les octets UTF-8 du texte (accents du libellé). */
function base64EncodeUtf8(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
