/**
 * Web Worker : la séparation tourne hors du fil principal pour ne pas figer
 * la page (1 à 3 s sur un visuel riche). Voir client.ts.
 *  - « separer » : choix des encres sur l'image d'analyse (moteur Reveal) ;
 *  - « films » : encres appliquées à l'image en pleine résolution (aplats) ;
 *  - « rendu » : aperçu du rendu choisi (aplats, diffusion, Bayer, trame AM) ;
 *  - « ecrans » : films en pleine résolution selon le rendu (lot 5).
 */
import reveal from "./reveal-core.js";
import { appliquerEncres, separer, type OptionsSeparation } from "./separer";
import { ecransFilms, indicesRendu, tonsRendu, type EntreeFilms } from "./ecrans";
import type { Rendu } from "./trame";

type Image = { px: Uint8ClampedArray; w: number; h: number };
type Demande =
  | ({ id: number; type?: "separer"; options: OptionsSeparation } & Image)
  | ({ id: number; type: "films"; encres: string[]; fond: string | null; transparent: boolean; pixelsMin: number; rentrePx: number | null } & Image)
  | ({ id: number; type: "rendu"; encres: string[]; fond: string | null; transparent: boolean; rendu: Rendu; ppp: number } & Image)
  | ({ id: number; type: "ecrans"; entree: EntreeFilms } & Image);

const contexte = self as unknown as {
  onmessage: ((e: MessageEvent<Demande>) => void) | null;
  postMessage(message: unknown, transfert?: Transferable[]): void;
};

contexte.onmessage = async (e) => {
  const d = e.data;
  try {
    let resultat: unknown;
    const transfert: Transferable[] = [];
    if (d.type === "films") {
      const f = appliquerEncres(d.px, d.w, d.h, d.encres, d.fond, d.transparent, d.pixelsMin, d.rentrePx);
      transfert.push(f.indices.buffer);
      if (f.sousCouche) transfert.push(f.sousCouche.buffer);
      resultat = f;
    } else if (d.type === "rendu") {
      const entree = { encres: d.encres, fond: d.fond, transparent: d.transparent, rendu: d.rendu, ppp: d.ppp };
      if (d.rendu.type === "am") {
        const tons = tonsRendu(d.px, d.w, d.h, entree);
        tons.forEach((t) => transfert.push(t.buffer));
        resultat = { tons };
      } else {
        const indices = indicesRendu(d.px, d.w, d.h, entree);
        transfert.push(indices.buffer);
        resultat = { indices };
      }
    } else if (d.type === "ecrans") {
      const f = ecransFilms(d.px, d.w, d.h, d.entree);
      f.ecrans.forEach((m) => transfert.push(m.buffer));
      resultat = f;
    } else {
      const r = await separer(reveal, d.px, d.w, d.h, d.options);
      transfert.push(r.indices.buffer);
      resultat = r;
    }
    contexte.postMessage({ id: d.id, resultat }, transfert);
  } catch (err) {
    contexte.postMessage({ id: d.id, erreur: err instanceof Error ? err.message : String(err) });
  }
};
