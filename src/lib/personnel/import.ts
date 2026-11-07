/**
 * Imports du personnel (migrations 0157 et 0159) : lecture et contrôle des
 * fichiers. Fonctions PURES (aucun accès base) : le contexte (employés,
 * ateliers) est passé en paramètre, ce qui permet de les tester sans Supabase.
 *
 *   fiches    liste du personnel, Excel (.xlsx) ou CSV, « format spécial » :
 *             matricule ; nom ; prénom ; département ; atelier ; fonction ; type_contrat ; statut
 *             Un matricule déjà connu est SAUTÉ (rien n'est écrasé) ; un
 *             matricule inconnu est ajouté. Seule exception : si la fiche
 *             connue n'a pas encore de département et que le fichier en donne un,
 *             le département (et la section qui en découle) est ajouté. Si le fichier a une colonne « État »
 *             (liste de salariés exportée de Sage) : E = actif et C = actif en
 *             congés sont importés ; M = ancien salarié (a quitté l'entreprise)
 *             est ignoré.
 *   paie      livre de paie exporté de Sage → voir livre-paie.ts
 *   presence  matricule ; jour ; statut ; heures   (CSV, provisoire : viendra
 *             de pointage-drh)
 */

export type TypeImport = "fiches" | "paie" | "presence";

export const TYPES_EMPLOI = ["production_directe", "encadrement_production", "structure"] as const;
export type TypeEmploi = (typeof TYPES_EMPLOI)[number];
export const STATUTS_EMPLOYE = ["actif", "suspendu", "sorti"] as const;
export type StatutEmploye = (typeof STATUTS_EMPLOYE)[number];
export const STATUTS_PRESENCE = ["present", "absent", "conge", "maladie", "ferie", "repos"] as const;
export type StatutPresence = (typeof STATUTS_PRESENCE)[number];
export const TYPES_CONTRAT = ["CDI", "CDD"] as const;
export type TypeContrat = (typeof TYPES_CONTRAT)[number];

export const LIBELLES_TYPE_EMPLOI: Record<TypeEmploi, string> = {
  production_directe: "Production directe",
  encadrement_production: "Encadrement production",
  structure: "Structure",
};

export const LIBELLES_IMPORT: Record<TypeImport, string> = {
  fiches: "Liste du personnel (Excel)",
  paie: "Livre de paie (Sage)",
  presence: "Présence jour par jour (CSV)",
};

/** Colonnes de la liste du personnel (Excel) : modèle téléchargeable et export. */
export const COLONNES_LISTE = ["matricule", "nom", "prenom", "departement", "atelier", "fonction", "type_contrat", "statut"] as const;
export const ENTETES_LISTE: Record<(typeof COLONNES_LISTE)[number], string> = {
  matricule: "Matricule",
  nom: "Nom",
  prenom: "Prénom",
  departement: "Département",
  atelier: "Atelier",
  fonction: "Fonction",
  type_contrat: "Type de contrat",
  statut: "Statut",
};

export const COLONNES_PRESENCE = ["matricule", "jour", "statut", "heures"];

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
  const negatif = v.startsWith("-");
  const abs = negatif ? v.slice(1) : v;
  const nettoye = /,\d{1,2}$/.test(abs) ? abs.replace(/\./g, "").replace(",", ".") : abs.replace(/[.,](?=\d{3}(\D|$))/g, "");
  if (!/^\d+(\.\d+)?$/.test(nettoye)) return Number.NaN;
  return negatif ? -Number(nettoye) : Number(nettoye);
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

/* ------------------------------------------------------------------------ */
/* Contexte et lignes de contrôle                                           */
/* ------------------------------------------------------------------------ */

export interface ContexteImport {
  /** Employés existants, par matricule normalisé. */
  employes: Map<string, { id: string; confidentiel: boolean; nomComplet?: string; departementCode?: string | null; aSection?: boolean }>;
  /** Départements de la paie Sage, par code ou par libellé normalisé. */
  departements?: Map<string, { code: string; sectionId: string | null; structure: boolean }>;
  /** Ateliers connus (Fiche de tâches), par nom ou libellé normalisé. */
  ateliers?: Map<string, { atelier: string; sectionId: string | null; structure: boolean }>;
}

export interface LigneImport {
  /** Numéro de ligne dans le fichier (l'en-tête est la ligne 1). */
  ligne: number;
  action: "creer" | "modifier" | "ignorer";
  matricule: string;
  donnees: Record<string, unknown>;
  erreurs: string[];
  avertissements: string[];
  /** Valeurs du fichier, par colonne : permet de corriger la ligne dans l'aperçu (liste et présence). */
  brut?: Record<string, string>;
  /** Ligne exclue de l'import par la personne qui valide. */
  exclue?: boolean;
  /** État de la ligne avant son exclusion, rétabli si on la réintègre. */
  origine?: { action: LigneImport["action"]; erreurs: string[]; avertissements: string[] };
}

/** Valeurs d'une ligne par intitulé de colonne (colonnes sans intitulé ignorées). */
export function brutDe(enTete: string[], cellules: string[]): Record<string, string> {
  const brut: Record<string, string> = {};
  enTete.forEach((nom, i) => {
    const cle = nom.trim();
    if (cle && !(cle in brut)) brut[cle] = (cellules[i] ?? "").trim();
  });
  return brut;
}

export interface ResultatLecture {
  lignes: LigneImport[];
  /** Erreur bloquant tout le fichier (en-tête illisible, fichier vide…). */
  erreurFichier?: string;
  mois?: string | null;
}

/** Autres intitulés acceptés pour une colonne (clé et alias déjà normalisés). */
const ALIAS_COLONNES: Record<string, string[]> = {
  etat: ["etatpaie", "etatsalarie", "etatdusalarie"],
  typecontrat: ["typedecontrat", "contrat"],
  prenom: ["prenoms"],
  atelier: ["section", "service"],
  fonction: ["poste"],
};

/** Indexe les colonnes d'un tableau de cellules par nom normalisé (alias compris). */
function indexerColonnes(enTete: string[]): (ligne: string[], colonne: string) => string {
  const idx = new Map<string, number>();
  enTete.map(normaliser).forEach((nom, i) => idx.set(nom, i));
  return (ligne, colonne) => {
    const cle = normaliser(colonne);
    const i = idx.get(cle) ?? (ALIAS_COLONNES[cle] ?? []).map((a) => idx.get(a)).find((v) => v !== undefined);
    return (ligne[i ?? -1] ?? "").trim();
  };
}

const aColonne = (enTete: string[], colonne: string) => {
  const noms = enTete.map(normaliser);
  const cle = normaliser(colonne);
  return noms.includes(cle) || (ALIAS_COLONNES[cle] ?? []).some((a) => noms.includes(a));
};

/** Code de département : Excel perd les zéros de tête (« 1 » pour « 001 »). */
function cleDepartement(valeur: string): string {
  const v = valeur.trim();
  return /^\d{1,3}$/.test(v) ? v.padStart(3, "0") : normaliser(v);
}

/** Matricule d'une cellule : Excel perd les zéros de tête (« 5 » pour « 0005 ») ; les matricules numériques courts sont complétés à 4 chiffres. */
export function lireMatricule(valeur: string): string {
  const v = valeur.replace(/^=/, "").replace(/\.0+$/, "").trim();
  return /^\d{1,3}$/.test(v) ? v.padStart(4, "0") : v;
}

/* ------------------------------------------------------------------------ */
/* Liste du personnel                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Liste du personnel. Matricule connu → sauté (nom identique) ou sauté avec
 * alerte (nom différent : rien n'est écrasé). Matricule inconnu → ajouté.
 */
export function controlerFiches(cellules: string[][], ctx: ContexteImport): ResultatLecture {
  if (cellules.length < 2) return { lignes: [], erreurFichier: "Le fichier est vide ou ne contient que l'en-tête." };
  const enTete = cellules[0];
  const manquantes = ["matricule", "nom"].filter((c) => !aColonne(enTete, c));
  if (manquantes.length > 0) {
    return { lignes: [], erreurFichier: `Colonnes manquantes : ${manquantes.join(", ")}. Colonnes attendues : ${COLONNES_LISTE.map((c) => ENTETES_LISTE[c]).join(" ; ")}.` };
  }
  const val = indexerColonnes(enTete);
  const lignes: LigneImport[] = [];
  const vus = new Set<string>();

  cellules.slice(1).forEach((cells, i) => {
    const erreurs: string[] = [];
    const avertissements: string[] = [];
    const matricule = lireMatricule(val(cells, "matricule"));
    const cle = normaliser(matricule);
    const nom = val(cells, "nom");
    const prenom = val(cells, "prenom");
    const nomComplet = `${nom} ${prenom}`.trim();
    const existant = ctx.employes.get(cle);

    // État Sage : E = actif, C = actif en congés (importés) ; M = a quitté l'entreprise (ignoré).
    const etat = val(cells, "etat").toUpperCase();
    if (etat === "M") {
      lignes.push({
        ligne: i + 2,
        action: "ignorer",
        matricule,
        donnees: { matricule, nom, prenom: prenom || null },
        erreurs: [],
        avertissements: ["Ancien salarié (état M) : ignoré"],
        brut: brutDe(enTete, cells),
      });
      return;
    }
    if (etat !== "" && etat !== "E" && etat !== "C") erreurs.push(`État inconnu : « ${etat} » (E actif, C actif en congés, M ancien salarié)`);

    if (!matricule) erreurs.push("Matricule manquant");
    if (matricule && vus.has(cle)) erreurs.push("Matricule présent deux fois dans le fichier");
    vus.add(cle);

    // Département de paie (code Sage ou libellé) → section ou structure.
    const departementBrut = val(cells, "departement");
    const departement = departementBrut ? ctx.departements?.get(cleDepartement(departementBrut)) : undefined;
    if (departementBrut && ctx.departements && !departement) {
      erreurs.push(`Département inconnu : « ${departementBrut} » (ajoutez-le dans l'onglet Départements)`);
    }

    let action: LigneImport["action"] = existant ? "ignorer" : "creer";
    let complement = false;
    if (existant) {
      if (existant.nomComplet && normaliser(existant.nomComplet) !== normaliser(nomComplet)) {
        avertissements.push(`Matricule déjà connu sous un autre nom (« ${existant.nomComplet} ») : fiche non modifiée`);
      } else if (departement && !existant.departementCode && !existant.confidentiel) {
        action = "modifier";
        complement = true;
        avertissements.push(`Fiche existante : département « ${departementBrut} » ajouté (rien d'autre n'est modifié)`);
      } else avertissements.push("Déjà présent : sauté");
    } else if (!nom) erreurs.push("Nom manquant");

    const contratBrut = val(cells, "type_contrat").toUpperCase().replace(/\s/g, "");
    const contrat = contratBrut === "" ? null : contratBrut === "CDI" || contratBrut === "CDD" ? contratBrut : undefined;
    if (contrat === undefined) erreurs.push(`Type de contrat inconnu : « ${val(cells, "type_contrat")} » (CDI ou CDD)`);
    const statutBrut = normaliser(val(cells, "statut"));
    const statut = statutBrut === "" ? "actif" : STATUTS_EMPLOYE.find((s) => s === statutBrut);
    if (!statut) erreurs.push(`Statut inconnu : « ${val(cells, "statut")} » (actif, suspendu ou sorti)`);

    // Atelier → section de la plateforme, ou structure, ou « à classer ».
    const atelierBrut = val(cells, "atelier");
    const atelier = atelierBrut ? ctx.ateliers?.get(normaliser(atelierBrut)) : undefined;
    let typeEmploi: TypeEmploi = "production_directe";
    const sections: { section_id: string; pourcentage: number }[] = [];
    // Le département de paie l'emporte sur l'atelier de la Fiche de tâches.
    if (departement?.structure) typeEmploi = "structure";
    else if (departement?.sectionId) sections.push({ section_id: departement.sectionId, pourcentage: 100 });
    else if (atelier?.structure) typeEmploi = "structure";
    else if (atelier?.sectionId) sections.push({ section_id: atelier.sectionId, pourcentage: 100 });
    else if ((departement || atelierBrut) && !existant) {
      avertissements.push(
        departement
          ? `Département « ${departementBrut} » pas encore rattaché à une section : section à classer (Paramètres > Personnel > Départements)`
          : `Atelier « ${atelierBrut} » ${atelier ? "pas encore rattaché à une section" : "inconnu"} : section à classer (Paramètres > Personnel)`
      );
    }

    if (existant?.confidentiel) action = "ignorer";

    lignes.push({
      ligne: i + 2,
      action,
      matricule,
      donnees: {
        matricule,
        nom,
        prenom: prenom || null,
        fonction: val(cells, "fonction") || null,
        type_emploi: typeEmploi,
        type_contrat: contrat ?? null,
        statut,
        departement_code: departement?.code ?? null,
        complement,
        a_section: existant?.aSection ?? false,
        atelier_source: atelierBrut ? (atelier?.atelier ?? normaliser(atelierBrut)) : null,
        atelier_libelle: atelierBrut || null,
        sections,
      },
      erreurs,
      avertissements,
      brut: brutDe(enTete, cells),
    });
  });
  return { lignes };
}

/* ------------------------------------------------------------------------ */
/* Présence                                                                 */
/* ------------------------------------------------------------------------ */

export function controlerPresence(texte: string, ctx: ContexteImport): ResultatLecture {
  return controlerPresenceCellules(lireCsv(texte), ctx);
}

export function controlerPresenceCellules(cellules: string[][], ctx: ContexteImport): ResultatLecture {
  if (cellules.length < 2) return { lignes: [], erreurFichier: "Le fichier est vide ou ne contient que l'en-tête." };
  const enTete = cellules[0];
  const manquantes = ["matricule", "jour", "statut"].filter((c) => !aColonne(enTete, c));
  if (manquantes.length > 0) {
    return { lignes: [], erreurFichier: `Colonnes manquantes : ${manquantes.join(", ")}. Colonnes attendues : ${COLONNES_PRESENCE.join(" ; ")}.` };
  }
  const val = indexerColonnes(enTete);
  const lignes: LigneImport[] = [];
  const vus = new Set<string>();

  cellules.slice(1).forEach((cells, i) => {
    const erreurs: string[] = [];
    const avertissements: string[] = [];
    const matricule = lireMatricule(val(cells, "matricule"));
    const existant = ctx.employes.get(normaliser(matricule));
    if (!matricule) erreurs.push("Matricule manquant");
    else if (!existant) erreurs.push(`Matricule inconnu : « ${matricule} » (importez d'abord la liste du personnel)`);
    if (existant?.confidentiel) avertissements.push("Employé confidentiel : ligne ignorée (aucune présence enregistrée)");

    const jour = lireDate(val(cells, "jour"));
    if (!jour) erreurs.push("Jour illisible (AAAA-MM-JJ ou JJ/MM/AAAA)");
    const statutBrut = normaliser(val(cells, "statut"));
    const statut = STATUTS_PRESENCE.find((s) => s === statutBrut);
    if (!statut) erreurs.push(`Statut de présence inconnu : « ${val(cells, "statut")} » (${STATUTS_PRESENCE.join(", ")})`);
    const heures = lireMontant(val(cells, "heures"));
    if (heures !== null && (Number.isNaN(heures) || heures < 0 || heures > 24)) erreurs.push("Heures invalides (0 à 24)");

    const doublon = `${normaliser(matricule)}|${jour}`;
    if (vus.has(doublon)) erreurs.push("Matricule présent deux fois ce jour-là");
    vus.add(doublon);

    lignes.push({
      ligne: i + 2,
      action: existant?.confidentiel ? "ignorer" : "creer",
      matricule,
      donnees: { matricule, jour: jour ?? null, statut, heures: heures !== null && !Number.isNaN(heures) ? heures : null },
      erreurs,
      avertissements,
      brut: brutDe(enTete, cells),
    });
  });
  return { lignes };
}
