import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Les écrans de mot de passe oublié/réinitialisation sont publics : ils sont
// atteints sans session (ou avec la seule session de récupération créée par
// /auth/confirm) ; chacun contrôle lui-même ce dont il a besoin.
// La confirmation de réception d'une livraison (LIV-2) est publique : le
// client l'ouvre depuis un e-mail, sans compte ; le jeton fait foi.
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/health",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/confirmation-livraison",
];

/** Préfixes de route → rôles autorisés. Défense en profondeur : la RLS reste
 * la garantie ultime, mais on évite ici de laisser un rôle non concerné
 * charger une page qui ne le concerne pas. */
const ROUTE_ACCESS: { prefix: string; roles: string[] }[] = [
  { prefix: "/client", roles: ["client"] },
  // Fiche client CRM (v4) : aussi utile au responsable production, qui suit
  // l'avancement de production par client sans repasser par le commercial.
  // Le responsable livraison y gère les lieux de livraison (LIV-0).
  { prefix: "/commercial/clients", roles: ["commercial", "responsable_production", "administrateur", "responsable_livraison"] },
  // Règle spécifique évaluée avant la règle générale /commercial ci-dessous :
  // l'échantillonnage est aussi géré par le responsable production (section
  // 2.1/2.7 de l'analyse), contrairement au reste de l'espace commercial.
  { prefix: "/commercial/echantillons", roles: ["commercial", "responsable_production", "administrateur"] },
  { prefix: "/commercial", roles: ["commercial", "administrateur"] },
  { prefix: "/infographie", roles: ["infographiste", "administrateur"] },
  // Gestionnaire de stock : accès aux ODF pour la partie Stock de chaque
  // fiche (réceptions/sorties/retours, migrations 0022/0023) — pas à
  // /atelier/section, qui reste le terminal des chefs de section.
  { prefix: "/atelier/production", roles: ["responsable_production", "administrateur", "gestionnaire_stock"] },
  { prefix: "/atelier/section", roles: ["chef_section", "responsable_production", "administrateur"] },
  // Règles spécifiques évaluées avant la règle générale /parametres ci-dessous :
  // ces écrans sont aussi utiles au responsable production et au commercial
  // (v4 : intégration Sage — stock, clients, articles).
  { prefix: "/parametres/stock", roles: ["responsable_production", "chef_section", "administrateur", "gestionnaire_stock"] },
  { prefix: "/parametres/clients-sage", roles: ["commercial", "responsable_production", "administrateur", "gestionnaire_stock"] },
  { prefix: "/parametres/articles-sage", roles: ["commercial", "responsable_production", "administrateur", "gestionnaire_stock"] },
  { prefix: "/parametres/devis-sage", roles: ["commercial", "responsable_production", "administrateur"] },
  // Codification (COM-0) : codes courts par la production, dépôts Sage par la gestion de stock.
  { prefix: "/parametres/codification", roles: ["responsable_production", "administrateur", "gestionnaire_stock"] },
  // Référentiels de livraison (LIV-0) : le service livraison.
  { prefix: "/parametres/livraison", roles: ["responsable_livraison", "administrateur"] },
  { prefix: "/parametres", roles: ["administrateur"] },
  // Prix de revient et marges (migration 0067) : Direction et administrateur
  // seulement (base_role administrateur) — jamais les commerciaux.
  { prefix: "/tarification", roles: ["administrateur"] },
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p)) || path === "/";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user) {
    const rule = ROUTE_ACCESS.find((r) => path.startsWith(r.prefix));
    if (rule) {
      const { data: profile } = await supabase
        .from("app_users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile || !rule.roles.includes(profile.role)) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        url.searchParams.set("erreur", "acces_refuse");
        return NextResponse.redirect(url);
      }
    }

    if (path === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
