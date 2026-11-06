/**
 * Import mensuel du personnel (migration 0157) : lecture et contrôle des
 * fichiers produits par le programme pointage-drh. Fonctions PURES (aucun
 * accès base) : le contexte (employés et sections existants) est passé en
 * paramètre, ce qui permet de les tester sans Supabase.
 *
 * Trois fichiers CSV (séparateur « ; » ou « , », en-tête obligatoire, accents
 * et majuscules ignorés dans les en-têtes) :
 *
 *   fiches    matricule;nom;fonction;type;section;salaire_base;primes_fixes;
 *             avantages;charges_patronales;date_entree;date_sortie;statut;confidentiel
 *   paie      matricule;mois;salaire_base;primes;heures_sup;avantages;charges_patronales
 *   presence  matricule;jour;statut;heures
 *
 * Le format définitif sera fixé avec le journal de paie réel (question Q3 du
 * plan) ; il reste volontairement plat et simple.
 */

export type TypeImport = "fiches" | "paie" | "presence";

export const TYPES_EMPLOI = ["production_directe", "encadrement_production", "structure"] as const;
export type TypeEmploi = (typeof TYPES_EMPLOI)[number];
export const STATUTS_EMPLOYE = ["actif", "suspendu", "sorti"] as const;
export type StatutEmploye = (typeof STATUTS_EMPLOYE)[number];
export const STATUTS_PRESENCE = ["present", "absent", "conge", "maladie", "ferie", "repos"] as const;
export type StatutPresence = (typeof STATUTS_PRESENCE)[number];

export const LIBELLES_TYPE_EMPLOI: Record<TypeEmploi, string> = {
  production_directe: "Production directe",
  encadrement_production: "Encadrement production",
  structure: "Structure",
};

export const LIBELLES_IMPORT: Record<TypeImport, string> = {
  fiches: "Fiches du personnel",
  paie: "Paie du mois",
  presence: "Présence jour par jour",
};

export const COLONNES_IMPORT: Record<TypeImport, string[]> = {
  fiches: ["matricule", "nom", "fonction", "type", "section", "salaire_base", "primes_fixes", "avantages", "charges_patronales", "date_entree", "date_sortie", "statut", "confidentiel"],
  paie: ["matricule", "mois", "salaire_base", "primes", "heures_sup", "avantages", "charges_patronales"],
  presence: ["matricule", "jour", "statut", "heures"],
};

/* ------------------------------------------------------------------------ */
/* Lecture CSV                                                              */
/* ------------------------------------------------------------------------ */

/** Retire accents, casse et séparateurs : « Charges patronales » → « chargespatronales ». */
export function normaliser(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Découpe un texte CSV en lignes de cellules (guillemets, « ; » ou « , », BOM, fins de ligne Windows). */
export function lireCsv(texte: string): string[][] {
  const brut = texte.replace(/^﻿/, "");
  const premiere = brut.split(/\r?\n/, 1)[0] ?? "";
  const sep = (premiere.match(/;/g)?.length ?? 0) >= (premiere.match(/,/g)?.length ?? 0) ? ";" : ",";
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let cellule = "";
  let entreGuillemets = false;
  for (let i = 0; i < brut.length; i++) {
    const c = brut[i];
    if (entreGuillemets) {
      if (c === '"' && brut[i + 1] === '"') {
        cellule += '"';
        i++;
      } else if (c === '"') entreGuillemets = false;
      else cellule += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === sep) {
      ligne.push(cellule.trim());
      cellule = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && brut[i + 1] === "\n") i++;
      ligne.push(cellule.trim());
      if (ligne.some((v) => v !== "")) lignes.push(ligne);
      ligne = [];
      cellule = "";
    } else cellule += c;
  }
  ligne.push(cellule.trim());
  if (ligne.some((v) => v !== "")) lignes.push(ligne);
  return lignes;
}

/** Montant saisi « 250 000 », « 250000,50 », « 250.000,5 » → nombre ; null si vide ; NaN si illisible. */
export function lireMontant(valeur: string): number | null {
  const v = valeur.replace(/[\s ]/g, "").replace(/f(cfa)?$/i, "");
  if (v === "") return null;
  const nettoye = /,\d{1,2}$/.test(v) ? v.replace(/\./g, "").replace(",", ".") : v.replace(/[.,](?=\d{3}(\D|$))/g, "");
  return /^\d+(\.\d+)?$/.test(nettoye) ? Number(nettoye) : Number.NaN;
}

/** Date « 2026-11-30 » ou « 30/11/2026 » → ISO ; null si vide ; undefined si illisible. */
export function lireDate(valeur: string): string | null | undefined {
  if (valeur === "") return null;
  let iso: string | null = null;
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  const m2 = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(valeur);
  if (m1) iso = `${m1[1]}-${m1[2]}-${m1[3]}`;
  else if (m2) iso = `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

function lireBooleen(valeur: string): boolean | undefined {
  const v = normaliser(valeur);
  if (v === "") return false;
  if (["1", "oui", "o", "vrai", "true", "x", "yes"].includes(v)) return true;
  if (["0", "non", "n", "faux", "false", "no"].includes(v)) return false;
  return undefined;
}

/* ------------------------------------------------------------------------ */
/* Contrôle des lignes                                                      */
/* ------------------------------------------------------------------------ */

export interface ContexteImport {
  /** Employés existants, par matricule normalisé. */
  employes: Map<string, { id: string; confidentiel: boolean }>;
  /** Sections d'atelier, par nom normalisé. */
  sections: Map<string, { id: string; nom: string }>;
}

export interface LigneImport {
  /** Numéro de ligne dans le fichier (l'en-tête est la ligne 1). */
  ligne: number;
  action: "creer" | "modifier" | "ignorer";
  matricule: string;
  donnees: Record<string, unknown>;
  erreurs: string[];
  avertissements: string[];
}

export interface ResultatLecture {
  lignes: LigneImport[];
  /** Erreur bloquant tout le fichier (en-tête illisible, fichier vide…). */
  erreurFichier?: string;
  mois?: string | null;
}

/** Section(s) d'une fiche : « Coupe » ou « Coupe:60|Finition:40 » (somme 100). */
function lireSections(valeur: string, ctx: ContexteImport, erreurs: string[]): { section_id: string; nom: string; pourcentage: number }[] {
  if (valeur === "") return [];
  const morceaux = valeur.split("|").map((s) => s.trim()).filter(Boolean);
  const resultat: { section_id: string; nom: string; pourcentage: number }[] = [];
  for (const morceau of morceaux) {
    const [nomBrut, pctBrut] = morceau.split(":").map((s) => s.trim());
    const section = ctx.sections.get(normaliser(nomBrut ?? ""));
    if (!section) {
      erreurs.push(`Section inconnue : « ${nomBrut} »`);
      continue;
    }
    const pct = pctBrut === undefined ? 100 : lireMontant(pctBrut.replace("%", ""));
    if (pct === null || Number.isNaN(pct) || pct <= 0 || pct > 100) {
      erreurs.push(`Pourcentage invalide pour la section « ${section.nom} »`);
      continue;
    }
    resultat.push({ section_id: section.id, nom: section.nom, pourcentage: pct });
  }
  if (resultat.length > 0 && erreurs.length === 0) {
    const total = resultat.reduce((s, r) => s + r.pourcentage, 0);
    if (Math.abs(total - 100) > 0.01) erreurs.push(`La répartition entre sections fait ${total} %, elle doit faire 100 %`);
  }
  return resultat;
}

/**
 * Lit un fichier et produit une ligne de contrôle par ligne du fichier.
 * Rien n'est écrit ici : l'aperçu est montré, puis appliqué sur validation.
 */
export function controlerFichier(type: TypeImport, texte: string, ctx: ContexteImport): ResultatLecture {
  const cellules = lireCsv(texte);
  if (cellules.length < 2) return { lignes: [], erreurFichier: "Le fichier est vide ou ne contient que l'en-tête." };

  const attendues = COLONNES_IMPORT[type];
  const enTete = cellules[0].map(normaliser);
  const idx = new Map<string, number>();
  enTete.forEach((nom, i) => idx.set(nom, i));
  const obligatoires = type === "fiches" ? ["matricule", "nom"] : type === "paie" ? ["matricule", "mois"] : ["matricule", "jour", "statut"];
  const manquantes = obligatoires.filter((c) => !idx.has(normaliser(c)));
  if (manquantes.length > 0) {
    return { lignes: [], erreurFichier: `Colonnes manquantes : ${manquantes.join(", ")}. Colonnes attendues : ${attendues.join(" ; ")}.` };
  }
  const val = (ligne: string[], col: string) => (ligne[idx.get(normaliser(col)) ?? -1] ?? "").trim();

  const lignes: LigneImport[] = [];
  const vus = new Set<string>();
  let mois: string | null | undefined;

  cellules.slice(1).forEach((cells, i) => {
    const numero = i + 2;
    const erreurs: string[] = [];
    const avertissements: string[] = [];
    const matricule = val(cells, "matricule");
    const cle = normaliser(matricule);
    const existant = ctx.employes.get(cle);
    const donnees: Record<string, unknown> = { matricule };

    if (!matricule) erreurs.push("Matricule manquant");

    if (type === "fiches") {
      const nom = val(cells, "nom");
      if (!nom) erreurs.push("Nom manquant");
      const typeBrut = normaliser(val(cells, "type"));
      const typeEmploi = typeBrut === "" ? "production_directe" : TYPES_EMPLOI.find((t) => normaliser(t) === typeBrut || normaliser(LIBELLES_TYPE_EMPLOI[t]) === typeBrut);
      if (!typeEmploi) erreurs.push(`Type inconnu : « ${val(cells, "type")} » (production_directe, encadrement_production ou structure)`);
      const statutBrut = normaliser(val(cells, "statut"));
      const statut = statutBrut === "" ? "actif" : STATUTS_EMPLOYE.find((s) => s === statutBrut);
      if (!statut) erreurs.push(`Statut inconnu : « ${val(cells, "statut")} » (actif, suspendu ou sorti)`);
      const confidentiel = lireBooleen(val(cells, "confidentiel"));
      if (confidentiel === undefined) erreurs.push("« confidentiel » : répondre oui ou non");
      const montants: Record<string, number | null> = {};
      for (const champ of ["salaire_base", "primes_fixes", "avantages", "charges_patronales"]) {
        const m = lireMontant(val(cells, champ));
        if (Number.isNaN(m)) erreurs.push(`Montant illisible : ${champ}`);
        montants[champ] = m;
      }
      const entree = lireDate(val(cells, "date_entree"));
      const sortie = lireDate(val(cells, "date_sortie"));
      if (entree === undefined) erreurs.push("Date d'entrée illisible (AAAA-MM-JJ ou JJ/MM/AAAA)");
      if (sortie === undefined) erreurs.push("Date de sortie illisible (AAAA-MM-JJ ou JJ/MM/AAAA)");
      if (entree && sortie && sortie < entree) erreurs.push("La sortie est antérieure à l'entrée");
      const sectionsLues = lireSections(val(cells, "section"), ctx, erreurs);
      if (confidentiel === true) {
        if (Object.values(montants).some((m) => m !== null)) avertissements.push("Employé confidentiel : les montants du fichier sont ignorés");
        for (const c of Object.keys(montants)) montants[c] = null;
      }
      Object.assign(donnees, {
        nom,
        fonction: val(cells, "fonction") || null,
        type_emploi: typeEmploi,
        statut,
        confidentiel: confidentiel === true,
        ...montants,
        date_entree: entree ?? null,
        date_sortie: sortie ?? null,
        sections: sectionsLues,
        section_renseignee: val(cells, "section") !== "",
      });
    } else {
      if (matricule && !existant) erreurs.push(`Matricule inconnu : « ${matricule} » (importez d'abord les fiches)`);
      if (existant?.confidentiel) avertissements.push("Employé confidentiel : ligne ignorée (aucun montant ni présence enregistré)");

      if (type === "paie") {
        const brut = val(cells, "mois");
        const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(brut) ?? (/^(\d{2})\/(\d{4})$/.test(brut) ? /^(\d{2})\/(\d{4})$/.exec(brut) : null);
        const moisLu = m ? (brut.includes("/") ? `${m[2]}-${m[1]}-01` : `${m[1]}-${m[2]}-01`) : null;
        if (!moisLu || lireDate(moisLu) === undefined) erreurs.push("Mois illisible (AAAA-MM)");
        else if (mois !== undefined && mois !== moisLu) erreurs.push("Plusieurs mois dans le même fichier : un fichier de paie = un mois");
        else mois = moisLu;
        const montants: Record<string, number> = {};
        for (const champ of ["salaire_base", "primes", "heures_sup", "avantages", "charges_patronales"]) {
          const v = lireMontant(val(cells, champ));
          if (v !== null && (Number.isNaN(v) || v < 0)) erreurs.push(`Montant illisible : ${champ}`);
          montants[champ] = v === null || Number.isNaN(v) ? 0 : v;
        }
        if (Object.values(montants).every((v) => v === 0)) avertissements.push("Tous les montants sont à zéro");
        Object.assign(donnees, { mois: moisLu, ...montants });
        const doublon = `${cle}|${moisLu}`;
        if (vus.has(doublon)) erreurs.push("Matricule présent deux fois pour ce mois");
        vus.add(doublon);
      } else {
        const jour = lireDate(val(cells, "jour"));
        if (!jour) erreurs.push("Jour illisible (AAAA-MM-JJ ou JJ/MM/AAAA)");
        const statutBrut = normaliser(val(cells, "statut"));
        const statut = STATUTS_PRESENCE.find((s) => s === statutBrut);
        if (!statut) erreurs.push(`Statut de présence inconnu : « ${val(cells, "statut")} » (${STATUTS_PRESENCE.join(", ")})`);
        const heuresBrutes = lireMontant(val(cells, "heures"));
        if (heuresBrutes !== null && (Number.isNaN(heuresBrutes) || heuresBrutes > 24)) erreurs.push("Heures invalides (0 à 24)");
        Object.assign(donnees, { jour: jour ?? null, statut, heures: heuresBrutes !== null && !Number.isNaN(heuresBrutes) ? heuresBrutes : null });
        const doublon = `${cle}|${jour}`;
        if (vus.has(doublon)) erreurs.push("Matricule présent deux fois ce jour-là");
        vus.add(doublon);
      }
    }

    if (type === "fiches") {
      if (matricule && vus.has(cle)) erreurs.push("Matricule présent deux fois dans le fichier");
      vus.add(cle);
    }

    const ignorer = type !== "fiches" && existant?.confidentiel === true;
    lignes.push({
      ligne: numero,
      action: ignorer ? "ignorer" : existant ? "modifier" : "creer",
      matricule,
      donnees,
      erreurs,
      avertissements,
    });
  });

  return { lignes, mois: mois ?? null };
}
