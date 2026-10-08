/**
 * Web Worker : la séparation tourne hors du fil principal pour ne pas figer
 * la page (1 à 3 s sur un visuel riche). Voir client.ts.
 *  - « separer » : choix des encres sur l'image d'analyse (moteur Reveal) ;
 *  - « films » : encres appliquées à l'image en pleine résolution.
 */
import reveal from "./reveal-core.js";
import { appliquerEncres, separer, type OptionsSeparation } from "./separer";

type Demande =
  | { id: number; type?: "separer"; px: Uint8ClampedArray; w: number; h: number; options: OptionsSeparation }
  | { id: number; type: "films"; px: Uint8ClampedArray; w: number; h: number; encres: string[]; fond: string | null; transparent: boolean; pixelsMin: number; rentrePx: number | null };

const contexte = self as unknown as {
  onmessage: ((e: MessageEvent<Demande>) => void) | null;
  postMessage(message: unknown, transfert?: Transferable[]): void;
};

contexte.onmessage = async (e) => {
  const d = e.data;
  try {
    const resultat =
      d.type === "films"
        ? appliquerEncres(d.px, d.w, d.h, d.encres, d.fond, d.transparent, d.pixelsMin, d.rentrePx)
        : await separer(reveal, d.px, d.w, d.h, d.options);
    const transfert: Transferable[] = [resultat.indices.buffer];
    if ("sousCouche" in resultat && resultat.sousCouche) transfert.push(resultat.sousCouche.buffer);
    contexte.postMessage({ id: d.id, resultat }, transfert);
  } catch (err) {
    contexte.postMessage({ id: d.id, erreur: err instanceof Error ? err.message : String(err) });
  }
};
