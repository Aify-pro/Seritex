import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth", "/api/health"];

/** Préfixes de route → rôles autorisés. Défense en profondeur : la RLS reste
 * la garantie ultime, mais on évite ici de laisser un rôle non concerné
 * charger une page qui ne le concerne pas. */
const ROUTE_ACCESS: { prefix: string; roles: string[] }[] = [
  { prefix: "/client", roles: ["client"] },
  { prefix: "/commercial", roles: ["commercial", "administrateur"] },
  { prefix: "/infographie", roles: ["infographiste", "administrateur"] },
  { prefix: "/atelier/production", roles: ["responsable_production", "administrateur"] },
  { prefix: "/atelier/section", roles: ["chef_section", "responsable_production", "administrateur"] },
  // Règles spécifiques évaluées avant la règle générale /admin ci-dessous :
  // ces deux écrans sont aussi utiles au responsable production.
  { prefix: "/admin/gammes", roles: ["responsable_production", "administrateur"] },
  { prefix: "/admin/stock", roles: ["responsable_production", "chef_section", "administrateur"] },
  { prefix: "/admin", roles: ["administrateur"] },
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
