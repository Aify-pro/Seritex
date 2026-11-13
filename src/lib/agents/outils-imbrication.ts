import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { declencherTraitement, insererCalcul, PREREGLAGES_TEMPS } from "@/lib/imbrication/calculs";
import { contexteTrace, lireTrace } from "@/lib/imbrication/contexte-trace";
import { laizesDuTissu, planPourTissu, tissusDesBesoins, type LigneBesoin } from "@/lib/imbrication/plan-coupe";
import { LIBELLES_ARRET } from "@/lib/imbrication/contrat";
import { rouleauxDuTrace } from "@/lib/patronnage/rouleaux-trace";
import type { AgentAuthentifie, DroitAgent } from "./jetons";

/**
 * Outils que les agents IA peuvent appeler pour piloter le calcul des tracés.
 *
 * Principe (décision du 2026-11-13) : c'est le MOTEUR qui optimise ; l'agent
 * lit les besoins, demande un plan de coupe, lance des calculs et compare.
 * Aucun outil ne fait d'un calcul le fichier d'un tracé, ni ne valide quoi
 * que ce soit : ces décisions restent humaines, dans Seritex.
 *
 * Chaque outil exige un droit de l'agent (« lecture » ou « calcul ») ET le
 * droit correspondant de son propriétaire, vérifié par la base au nom de ce
 * propriétaire à chaque appel. Chaque appel est journalisé.
 */

export interface ContexteOutil {
  admin: SupabaseClient;
  agent: AgentAuthentifie;
}

export interface Outil {
  nom: string;
  titre: string;
  description: string;
  droit: DroitAgent;
  schema: z.ZodType;
  executer: (ctx: ContexteOutil, args: never) => Promise<unknown>;
}

/** Erreur à renvoyer telle quelle à l'agent (message en français, sans détail technique). */
export class ErreurOutil extends Error {}

const DROIT_PROPRIETAIRE: Record<DroitAgent, [string, string]> = {
  lecture: ["patronnage", "view"],
  calcul: ["patronnage_traces", "create"],
};

/** Plafond de calculs en cours par agent (le calcul coûte du temps de serveur). */
const MAX_CALCULS_EN_COURS = 8;

async function besoins(ctx: ContexteOutil): Promise<LigneBesoin[]> {
  const { data, error } = await ctx.admin.rpc("besoins_coupe_agent", { p_user: ctx.agent.proprietaire });
  if (error) throw new ErreurOutil(`Lecture des besoins de coupe impossible : ${error.message}`);
  return (data ?? []) as LigneBesoin[];
}

const uuid = z.string().uuid();

const outils: Outil[] = [
  {
    nom: "besoins_de_coupe",
    titre: "Besoins de coupe",
    description:
      "Ce qu'il reste à couper pour les ordres de fabrication ouverts. Sans tissu : la liste des tissus avec le nombre de pièces restantes. Avec un tissu (textileId) : le détail par semi-fini, taille et couleur.",
    droit: "lecture",
    schema: z.object({ textileId: uuid.optional().describe("Identifiant du tissu (donné par l'appel sans argument)") }).strict(),
    async executer(ctx, args: { textileId?: string }) {
      const lignes = await besoins(ctx);
      if (!args.textileId) return { tissus: tissusDesBesoins(lignes) };
      return {
        besoins: lignes
          .filter((l) => l.textile_id === args.textileId && Number(l.reste) > 0)
          .map((l) => ({ semiFiniId: l.semi_fini_id, semiFini: l.semi_fini_nom, taille: l.taille, couleur: l.couleur ?? "Sans couleur", reste: Number(l.reste), formes: l.formes ?? [] })),
      };
    },
  },
  {
    nom: "laizes_disponibles",
    titre: "Laizes des rouleaux en stock",
    description: "Laizes (cm) des rouleaux en stock d'un tissu (tissu ouvert), avec le nombre de rouleaux et le poids total.",
    droit: "lecture",
    schema: z.object({ textileId: uuid }).strict(),
    async executer(ctx, args: { textileId: string }) {
      return { laizes: await laizesDuTissu(ctx.admin, args.textileId) };
    },
  },
  {
    nom: "planifier_coupe",
    titre: "Plan de coupe",
    description:
      "Calcule (de façon déterministe, sans surplus) les matelas à faire pour un tissu : pièces par couche et plis par couleur, avec une longueur et un tissu ESTIMÉS. Comparer plusieurs laizes = appeler l'outil une fois par laize. La vraie longueur vient ensuite du calcul de chaque tracé.",
    droit: "lecture",
    schema: z
      .object({
        textileId: uuid,
        laizeCm: z.number().positive().max(1000).describe("Laize du tissu (cm)"),
        lisiereMm: z.number().min(0).max(100).optional().describe("Lisière retirée de chaque bord (mm), 0 par défaut"),
        longueurTableCm: z.number().positive().max(10_000).describe("Longueur maximale d'une couche (table de coupe), cm"),
        maxPlis: z.number().int().min(1).max(1000).describe("Plis maximum d'un matelas, toutes couleurs"),
        efficiencePct: z.number().min(50).max(95).optional().describe("Efficience estimée des tracés, % (85 par défaut)"),
        couleurs: z.array(z.string()).optional().describe("Limiter à ces couleurs"),
      })
      .strict(),
    async executer(ctx, args: Parameters<typeof planPourTissu>[2]) {
      const r = await planPourTissu(ctx.admin, await besoins(ctx), args);
      if ("error" in r) throw new ErreurOutil(r.error);
      return r;
    },
  },
  {
    nom: "lister_traces",
    titre: "Tracés en préparation",
    description: "Tracés en préparation (ou prévisionnels), avec leur ordre, leurs pièces par couche, leur forme, leur laize et l'origine de leur fichier.",
    droit: "lecture",
    schema: z.object({ ficheId: uuid.optional().describe("Limiter à une fiche / un ordre de tracé") }).strict(),
    async executer(ctx, args: { ficheId?: string }) {
      let q = ctx.admin
        .from("traces_placement")
        .select(
          "id,reference,statut,forme,largeur_matelas_cm,longueur_matelas_cm,fichier_nom,imbrication_calcul_id,fiche_id,fiches_placement(numero_ot,designation_article,statut),trace_semi_finis(taille,quantite_par_couche,product_models(name))"
        )
        .in("statut", ["previsionnel", "en_preparation"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (args.ficheId) q = q.eq("fiche_id", args.ficheId);
      const { data, error } = await q;
      if (error) throw new ErreurOutil(error.message);
      type Ligne = {
        id: string;
        reference: string | null;
        statut: string;
        forme: string;
        largeur_matelas_cm: number | null;
        longueur_matelas_cm: number | null;
        fichier_nom: string | null;
        imbrication_calcul_id: string | null;
        fiche_id: string;
        fiches_placement: { numero_ot: string; designation_article: string | null; statut: string } | null;
        trace_semi_finis: { taille: string; quantite_par_couche: number; product_models: { name: string } | null }[];
      };
      return {
        traces: ((data ?? []) as unknown as Ligne[])
          .filter((t) => t.fiches_placement?.statut !== "archive")
          .map((t) => ({
            traceId: t.id,
            reference: t.reference,
            ficheId: t.fiche_id,
            ordre: t.fiches_placement?.numero_ot ?? null,
            statut: t.statut,
            forme: t.forme,
            laizeCm: t.largeur_matelas_cm === null ? null : Number(t.largeur_matelas_cm),
            longueurCm: t.longueur_matelas_cm === null ? null : Number(t.longueur_matelas_cm),
            fichier: t.fichier_nom ? (t.imbrication_calcul_id ? "calculé par Seritex" : "déposé (Modaris / Diamino)") : "aucun",
            piecesParCouche: t.trace_semi_finis.map((p) => ({ semiFini: p.product_models?.name ?? "?", taille: p.taille, quantite: p.quantite_par_couche })),
          })),
      };
    },
  },
  {
    nom: "contexte_trace",
    titre: "Contexte d'un tracé",
    description: "Pièces par couche d'un tracé, laizes proposées (rouleaux choisis ou en stock) et ce qui empêcherait de lancer un calcul.",
    droit: "lecture",
    schema: z.object({ traceId: uuid }).strict(),
    async executer(ctx, args: { traceId: string }) {
      const rouleaux = await rouleauxDuTrace(ctx.admin, args.traceId, async () => {
        const { data } = await ctx.admin.rpc("reservations_rouleaux_agent", { p_user: ctx.agent.proprietaire });
        return (data ?? []) as unknown[];
      });
      const c = await contexteTrace(ctx.admin, args.traceId, rouleaux);
      if ("error" in c) throw new ErreurOutil(c.error);
      return c;
    },
  },
  {
    nom: "lancer_calcul_trace",
    titre: "Lancer le calcul d'un tracé",
    description:
      "Lance le calcul du tracé par le moteur Seritex, une fois par laize (jusqu'à 4, pour comparer). Le résultat est une PROPOSITION : seule une personne peut en faire le fichier du tracé, dans Seritex. Suivre avec etat_calculs_trace.",
    droit: "calcul",
    schema: z
      .object({
        traceId: uuid,
        laizesCm: z.array(z.number().positive().max(1000)).min(1).max(4).describe("Laize(s) à calculer, cm"),
        duree: z.enum(["rapide", "normal", "approfondi"]).describe("rapide = 30 s, normal = 2 min, approfondi = 10 min"),
        lisiereMm: z.number().min(0).max(100).optional(),
        espacementMm: z.number().min(0).max(20).optional(),
      })
      .strict(),
    async executer(ctx, args: { traceId: string; laizesCm: number[]; duree: keyof typeof PREREGLAGES_TEMPS; lisiereMm?: number; espacementMm?: number }) {
      const { count } = await ctx.admin
        .from("imbrication_calculs")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", ctx.agent.id)
        .in("statut", ["en_attente", "en_cours"]);
      if ((count ?? 0) + args.laizesCm.length > MAX_CALCULS_EN_COURS) {
        throw new ErreurOutil(`Trop de calculs en cours pour cet agent (${count}) : attendez qu'ils se terminent (${MAX_CALCULS_EN_COURS} au plus).`);
      }
      const trace = await lireTrace(ctx.admin, args.traceId);
      if (!trace) throw new ErreurOutil("Tracé introuvable.");
      const contexte = await contexteTrace(ctx.admin, args.traceId, { error: "rouleaux non lus" });
      if ("error" in contexte) throw new ErreurOutil(contexte.error);
      if (contexte.blocage) throw new ErreurOutil(contexte.blocage);
      if (!contexte.modifiable) throw new ErreurOutil("Ce tracé n'est plus en préparation.");

      const groupe = randomUUID();
      const ids: string[] = [];
      for (const laizeCm of [...new Set(args.laizesCm.map((l) => Math.round(l * 10) / 10))]) {
        const r = await insererCalcul(
          ctx.admin,
          {
            libelle: `Laize ${laizeCm.toLocaleString("fr-FR")} cm`,
            ficheId: trace.fiche_id as string,
            traceId: args.traceId,
            groupe,
            demandes: contexte.pieces.map((p) => ({ semiFiniId: p.semiFiniId, taille: p.taille, quantite: p.quantite })),
            tissu: { largeurUtileMm: laizeCm * 10, margeLisiereMm: args.lisiereMm ?? 0, espacementMm: args.espacementMm ?? 0 },
            tempsS: PREREGLAGES_TEMPS[args.duree],
          },
          { demandePar: ctx.agent.proprietaire, agent: { id: ctx.agent.id, nom: ctx.agent.nom } },
          { declencher: false }
        );
        if ("error" in r) throw new ErreurOutil(`Laize ${laizeCm} cm : ${r.error}`);
        ids.push(r.id);
      }
      await declencherTraitement(ids.length);
      return { groupe, calculs: ids, dureeS: PREREGLAGES_TEMPS[args.duree], message: "Calculs lancés. Résultat : etat_calculs_trace. Le choix du tracé reste à une personne." };
    },
  },
  {
    nom: "etat_calculs_trace",
    titre: "État des calculs d'un tracé",
    description: "Calculs lancés pour un tracé : état, avancement, longueur, efficience et tissu par couche (m²) ; le meilleur du dernier groupe est signalé.",
    droit: "lecture",
    schema: z.object({ traceId: uuid }).strict(),
    async executer(ctx, args: { traceId: string }) {
      const { data, error } = await ctx.admin
        .from("imbrication_calculs")
        .select("id,libelle,groupe,statut,temps_total_s,temps_consomme_s,longueur_mm,taux_utilisation,erreur_message,demande_par_agent,created_at,laize:entree->tissu->largeur_utile,arret:meilleur->arret")
        .eq("trace_id", args.traceId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new ErreurOutil(error.message);
      const { data: trace } = await ctx.admin.from("traces_placement").select("imbrication_calcul_id").eq("id", args.traceId).maybeSingle();
      const calculs = (data ?? []).map((c) => {
        const laize = Number(c.laize);
        const longueur = c.longueur_mm === null ? null : Number(c.longueur_mm);
        return {
          calculId: c.id,
          libelle: c.libelle,
          groupe: c.groupe,
          statut: c.statut,
          avancementPct: Math.round(Math.min(100, (Number(c.temps_consomme_s) / Number(c.temps_total_s)) * 100)),
          laizeCm: laize / 10,
          longueurCm: longueur === null ? null : Math.round(longueur) / 10,
          efficiencePct: c.taux_utilisation === null ? null : Math.round(Number(c.taux_utilisation) * 1000) / 10,
          tissuParCoucheM2: longueur === null ? null : Math.round(((longueur * laize) / 1e6) * 1000) / 1000,
          arret: c.arret ? (LIBELLES_ARRET[c.arret as keyof typeof LIBELLES_ARRET] ?? null) : null,
          erreur: c.erreur_message,
          proposePar: c.demande_par_agent ?? "une personne",
          fichierDuTrace: trace?.imbrication_calcul_id === c.id,
        };
      });
      const dernier = calculs[0]?.groupe;
      const termines = calculs.filter((c) => c.groupe === dernier && c.statut === "termine" && c.tissuParCoucheM2 !== null);
      const meilleur = termines.length ? termines.reduce((a, b) => (b.tissuParCoucheM2! < a.tissuParCoucheM2! ? b : a)).calculId : null;
      return { calculs, meilleurDuDernierGroupe: meilleur };
    },
  },
  {
    nom: "arreter_calcul",
    titre: "Arrêter un calcul",
    description: "Arrête un calcul lancé par CET agent. Un calcul déjà commencé garde son meilleur tracé.",
    droit: "calcul",
    schema: z.object({ calculId: uuid }).strict(),
    async executer(ctx, args: { calculId: string }) {
      const { data: c } = await ctx.admin.from("imbrication_calculs").select("statut,agent_id").eq("id", args.calculId).maybeSingle();
      if (!c || c.agent_id !== ctx.agent.id) throw new ErreurOutil("Calcul introuvable parmi ceux de cet agent.");
      if (c.statut === "en_attente") {
        await ctx.admin.from("imbrication_calculs").update({ statut: "annule", fin_le: new Date().toISOString() }).eq("id", args.calculId).eq("statut", "en_attente");
        return { resultat: "annule" };
      }
      if (c.statut === "en_cours") {
        await ctx.admin.from("imbrication_calculs").update({ annulation_demandee_le: new Date().toISOString() }).eq("id", args.calculId);
        return { resultat: "annulation_demandee" };
      }
      throw new ErreurOutil("Ce calcul est déjà fini.");
    },
  },
];

export function catalogueOutils() {
  return outils.map((o) => ({
    name: o.nom,
    title: o.titre,
    description: `${o.description} (droit requis : ${o.droit})`,
    inputSchema: z.toJSONSchema(o.schema, { target: "draft-2020-12" }) as Record<string, unknown>,
  }));
}

/** Résumé gardé au journal : le résultat s'il est court, sinon sa taille. */
function resume(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s.length <= 4000 ? v : { taille: s.length, apercu: s.slice(0, 500) };
}

export type ResultatOutil = { ok: true; resultat: unknown } | { ok: false; refuse: boolean; message: string };

export async function appelerOutil(agent: AgentAuthentifie, nom: string, args: unknown): Promise<ResultatOutil> {
  const admin = createAdminClient();
  const debut = Date.now();
  const journal = (statut: "ok" | "erreur" | "refuse", resultat: unknown, erreur: string | null) =>
    admin.from("agents_ia_journal").insert({
      agent_id: agent.id,
      outil: nom.slice(0, 80),
      arguments: (args && typeof args === "object" ? args : {}) as Record<string, unknown>,
      statut,
      resultat: resultat === null ? null : resume(resultat),
      erreur,
      duree_ms: Date.now() - debut,
    });

  const outil = outils.find((o) => o.nom === nom);
  if (!outil) {
    await journal("refuse", null, "outil inconnu");
    return { ok: false, refuse: true, message: `Outil inconnu : ${nom}.` };
  }
  if (!agent.droits.includes(outil.droit)) {
    const message = `Cet agent n'a pas le droit « ${outil.droit} » demandé par l'outil ${nom}.`;
    await journal("refuse", null, message);
    return { ok: false, refuse: true, message };
  }
  const [module, action] = DROIT_PROPRIETAIRE[outil.droit];
  const { data: autorise } = await admin.rpc("agent_a_le_droit", { p_user: agent.proprietaire, p_module: module, p_action: action });
  if (autorise !== true) {
    const message = "Le propriétaire de cet agent n'a pas (ou plus) le droit correspondant dans Seritex.";
    await journal("refuse", null, message);
    return { ok: false, refuse: true, message };
  }
  const lecture = outil.schema.safeParse(args ?? {});
  if (!lecture.success) {
    const message = `Arguments invalides : ${lecture.error.issues.map((i) => `${i.path.join(".") || "(racine)"} — ${i.message}`).join(" ; ")}`;
    await journal("erreur", null, message);
    return { ok: false, refuse: false, message };
  }
  try {
    const resultat = await outil.executer({ admin, agent }, lecture.data as never);
    await journal("ok", resultat, null);
    return { ok: true, resultat };
  } catch (e) {
    const message = e instanceof ErreurOutil ? e.message : "Erreur interne de Seritex pendant l'appel de l'outil.";
    if (!(e instanceof ErreurOutil)) console.error("[agents] outil en échec", nom, e);
    await journal("erreur", null, message);
    return { ok: false, refuse: false, message };
  }
}
