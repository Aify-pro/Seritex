import "server-only";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { entreeSchema, sortieSchema, type EntreeImbrication, type EntreeImbricationNormalisee, type SortieImbrication } from "./contrat";
import { controlerContours, validerTrace, type ResultatValidation } from "./validation";

/**
 * Exécution du moteur d'imbrication DANS Seritex.
 *
 * Le moteur (Rust, `rust/imbrication`) est compilé en WebAssembly (cible
 * wasm32-wasip1) et livré avec le code (`moteur/seritex-imbrication.wasm`,
 * reconstruit par `npm run build:imbrication`). Node l'exécute avec son
 * module WASI standard : aucun service externe, aucun binaire à installer,
 * même fonctionnement sur Vercel aujourd'hui et sur un serveur Seritex demain.
 *
 * Le calcul dure de quelques secondes à plusieurs minutes : il tourne dans
 * un thread séparé (worker) pour ne jamais bloquer le serveur. Les échanges
 * passent par un dossier temporaire propre au calcul : entrée, sortie,
 * journal d'erreurs du moteur, et fichier d'annulation.
 */

const CHEMIN_WASM_DEFAUT = path.join(process.cwd(), "src/lib/imbrication/moteur/seritex-imbrication.wasm");

/** Chemin du fichier d'annulation tel que le voit le moteur (dossier monté). */
const DOSSIER_MOTEUR = "/travail";

/** Délai laissé au moteur, au-delà de son temps maximal, avant de l'arrêter de force. */
const MARGE_ARRET_FORCE_MS = 30_000;

export type ResultatMoteur =
  | {
      ok: true;
      entree: EntreeImbricationNormalisee;
      sortie: SortieImbrication;
      /** Contrôle indépendant du tracé ; `validation.valide` faux = tracé inutilisable. */
      validation: ResultatValidation;
    }
  | {
      ok: false;
      /** Code stable : `entree_invalide`, `contour_invalide`, `moteur_*` ou code d'erreur du moteur. */
      code: string;
      /** Message en français, à montrer tel quel à l'utilisateur. */
      message: string;
      pieceId?: string;
    };

export interface CalculImbrication {
  resultat: Promise<ResultatMoteur>;
  /** Demande l'arrêt : le moteur rend la meilleure solution trouvée jusque-là. */
  annuler(): Promise<void>;
}

let moduleCache: { chemin: string; module: Promise<WebAssembly.Module> } | null = null;

function moduleWasm(chemin: string): Promise<WebAssembly.Module> {
  if (!moduleCache || moduleCache.chemin !== chemin) {
    const compile = readFile(chemin).then((octets) => WebAssembly.compile(octets));
    compile.catch(() => {
      moduleCache = null;
    });
    moduleCache = { chemin, module: compile };
  }
  return moduleCache.module;
}

/**
 * Code du thread de calcul (CommonJS évalué à la volée : pas de fichier
 * séparé à faire suivre par le bundler). Il ne fait qu'exécuter le module
 * WASI avec les fichiers du dossier de travail.
 */
const CODE_THREAD = `
const { workerData, parentPort } = require("node:worker_threads");
const { WASI } = require("node:wasi");
const fs = require("node:fs");
const path = require("node:path");
const d = workerData.dossier;
const wasi = new WASI({
  version: "preview1",
  args: ["seritex-imbrication"],
  env: {},
  preopens: { [workerData.dossierMoteur]: d },
  stdin: fs.openSync(path.join(d, "entree.json"), "r"),
  stdout: fs.openSync(path.join(d, "sortie.json"), "w"),
  stderr: fs.openSync(path.join(d, "journal.txt"), "w"),
  returnOnExit: true,
});
const instance = new WebAssembly.Instance(workerData.module, wasi.getImportObject());
parentPort.postMessage({ code: wasi.start(instance) });
`;

/** Lance un calcul ; voir `imbriquer` pour la version simple. */
export interface OptionsMoteur {
  cheminWasm?: string;
  /** Binaire natif à utiliser à la place du WebAssembly (défaut : IMBRICATION_BINAIRE ; null = WebAssembly). */
  binaireNatif?: string | null;
}

export function lancerImbrication(entreeBrute: EntreeImbrication, options: OptionsMoteur = {}): CalculImbrication {
  let dossier: string | null = null;
  let annulationDemandee = false;

  const resultat = (async (): Promise<ResultatMoteur> => {
    const lecture = entreeSchema.safeParse(entreeBrute);
    if (!lecture.success) {
      const premier = lecture.error.issues[0];
      return {
        ok: false,
        code: "entree_invalide",
        message: `Paramètres de tracé invalides (${premier?.path.join(".") || "entrée"} : ${premier?.message ?? "valeur refusée"}).`,
      };
    }
    const entree = lecture.data;
    const contours = controlerContours(entree.pieces);
    if (contours.length > 0) {
      return { ok: false, code: "contour_invalide", message: contours[0].message, pieceId: contours[0].pieceId };
    }

    // Serveur Seritex : le même moteur compilé en natif (plusieurs cœurs,
    // nettement meilleur à temps égal) s'il est installé ; sinon WebAssembly.
    const binaire = options.binaireNatif === undefined ? process.env.IMBRICATION_BINAIRE || null : options.binaireNatif;
    const moduleCompile = binaire
      ? null
      : await moduleWasm(options.cheminWasm ?? process.env.IMBRICATION_WASM ?? CHEMIN_WASM_DEFAUT).catch(() => null);
    if (!binaire && !moduleCompile) {
      return { ok: false, code: "moteur_absent", message: "Le moteur d'imbrication est introuvable sur ce serveur." };
    }

    dossier = await mkdtemp(path.join(tmpdir(), "seritex-imbrication-"));
    try {
      const annulation = binaire ? path.join(dossier, "annuler") : `${DOSSIER_MOTEUR}/annuler`;
      const pourMoteur = { ...entree, calcul: { ...entree.calcul, fichier_annulation: annulation } };
      await writeFile(path.join(dossier, "entree.json"), JSON.stringify(pourMoteur));
      if (annulationDemandee) await writeFile(path.join(dossier, "annuler"), "");

      const delai = entree.calcul.temps_max_s * 1000 + MARGE_ARRET_FORCE_MS;
      const fin = binaire ? await executerNatif(binaire, dossier, delai) : await executer(moduleCompile!, dossier, delai);
      if (fin.type === "delai") {
        return { ok: false, code: "moteur_delai", message: "Le calcul a dépassé son temps maximal et a été interrompu sans résultat." };
      }
      if (fin.type === "plantage" || fin.code !== 0) {
        const journal = (await readFile(path.join(dossier, "journal.txt"), "utf8").catch(() => "")).trim();
        console.error("[imbrication] arrêt anormal du moteur", fin, journal.slice(0, 2000));
        return {
          ok: false,
          code: "moteur_plante",
          message: "Le moteur d'imbrication s'est arrêté de façon inattendue. Réessayez ; si le problème revient, signalez-le avec les pièces concernées.",
        };
      }

      const brut = await readFile(path.join(dossier, "sortie.json"), "utf8");
      let sortie: SortieImbrication;
      try {
        sortie = sortieSchema.parse(JSON.parse(brut));
      } catch {
        return { ok: false, code: "moteur_sortie_illisible", message: "Le moteur a rendu un résultat illisible." };
      }
      if (sortie.statut === "echec") {
        return {
          ok: false,
          code: sortie.erreur?.code ?? "moteur_echec",
          message: sortie.erreur?.message ?? "Le moteur n'a pas pu produire de tracé.",
          pieceId: sortie.erreur?.piece_id,
        };
      }
      return { ok: true, entree, sortie, validation: validerTrace(entree, sortie) };
    } finally {
      const d = dossier;
      dossier = null;
      await rm(d, { recursive: true, force: true }).catch(() => {});
    }
  })();

  return {
    resultat,
    async annuler() {
      annulationDemandee = true;
      if (dossier) await writeFile(path.join(dossier, "annuler"), "").catch(() => {});
    },
  };
}

type FinThread = { type: "fin"; code: number } | { type: "plantage"; erreur: string } | { type: "delai" };

function executer(moduleCompile: WebAssembly.Module, dossier: string, delaiMs: number): Promise<FinThread> {
  return new Promise((resolve) => {
    const worker = new Worker(CODE_THREAD, { eval: true, workerData: { module: moduleCompile, dossier, dossierMoteur: DOSSIER_MOTEUR } });
    let fini = false;
    const terminer = (f: FinThread) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      resolve(f);
    };
    const minuterie = setTimeout(() => {
      void worker.terminate();
      terminer({ type: "delai" });
    }, delaiMs);
    worker.on("message", (m: { code: number }) => terminer({ type: "fin", code: m.code }));
    worker.on("error", (e) => terminer({ type: "plantage", erreur: e instanceof Error ? e.message : String(e) }));
    worker.on("exit", (code) => terminer(code === 0 ? { type: "fin", code: 0 } : { type: "plantage", erreur: `sortie ${code}` }));
  });
}

/** Même échange de fichiers, avec le binaire natif dans un processus séparé. */
function executerNatif(binaire: string, dossier: string, delaiMs: number): Promise<FinThread> {
  return new Promise((resolve) => {
    const fds = [
      openSync(path.join(dossier, "entree.json"), "r"),
      openSync(path.join(dossier, "sortie.json"), "w"),
      openSync(path.join(dossier, "journal.txt"), "w"),
    ];
    let fini = false;
    const terminer = (f: FinThread) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      fds.forEach((fd) => closeSync(fd));
      resolve(f);
    };
    // Aucune variable d'environnement transmise : le moteur n'a besoin d'aucun secret.
    const enfant: ChildProcess = spawn(binaire, [], { stdio: [fds[0], fds[1], fds[2]], env: {} as NodeJS.ProcessEnv });
    const minuterie = setTimeout(() => {
      enfant.kill("SIGKILL");
      terminer({ type: "delai" });
    }, delaiMs);
    enfant.on("error", (e) => terminer({ type: "plantage", erreur: e.message }));
    enfant.on("exit", (code, signal) => terminer(code === 0 ? { type: "fin", code: 0 } : { type: "plantage", erreur: `sortie ${code ?? signal}` }));
  });
}

/** Calcule un tracé et le contrôle. */
export function imbriquer(entree: EntreeImbrication, options: OptionsMoteur = {}): Promise<ResultatMoteur> {
  return lancerImbrication(entree, options).resultat;
}
