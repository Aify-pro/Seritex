/**
 * Web Worker : la séparation tourne hors du fil principal pour ne pas figer
 * la page (1 à 3 s sur un visuel riche). Voir client.ts.
 */
import reveal from "./reveal-core.js";
import { separer, type OptionsSeparation } from "./separer";

type Demande = { id: number; px: Uint8ClampedArray; w: number; h: number; options: OptionsSeparation };

const contexte = self as unknown as {
  onmessage: ((e: MessageEvent<Demande>) => void) | null;
  postMessage(message: unknown, transfert?: Transferable[]): void;
};

contexte.onmessage = async (e) => {
  const { id, px, w, h, options } = e.data;
  try {
    const resultat = await separer(reveal, px, w, h, options);
    contexte.postMessage({ id, resultat }, [resultat.indices.buffer]);
  } catch (err) {
    contexte.postMessage({ id, erreur: err instanceof Error ? err.message : String(err) });
  }
};
