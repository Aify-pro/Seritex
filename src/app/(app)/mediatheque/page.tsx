import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { Folder } from "lucide-react";

/** Index de la médiathèque : un client à la fois (section 3.7 de l'analyse). */
export default async function MediathequeIndexPage() {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { data: companies } = await supabase.from("companies").select("id,name").order("name");
  const { data: files } = await supabase.from("media_files").select("company_id,created_at");

  const stats = new Map<string, { count: number; lastAdded: string }>();
  for (const f of files ?? []) {
    const current = stats.get(f.company_id);
    if (!current || f.created_at > current.lastAdded) {
      stats.set(f.company_id, { count: (current?.count ?? 0) + 1, lastAdded: f.created_at });
    } else {
      stats.set(f.company_id, { count: current.count + 1, lastAdded: current.lastAdded });
    }
  }

  const sorted = [...(companies ?? [])].sort((a, b) => {
    const da = stats.get(a.id)?.lastAdded ?? "";
    const db = stats.get(b.id)?.lastAdded ?? "";
    return db.localeCompare(da);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Médiathèque"
        description="Fichiers liés à chaque client, triés par date d'ajout, avec la raison de chaque dépôt ou mise à jour."
      />
      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {sorted.map((c) => {
              const s = stats.get(c.id);
              return (
                <li key={c.id}>
                  <Link
                    href={`/mediatheque/${c.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Folder className="h-4 w-4 text-foreground-muted" /> {c.name}
                    </span>
                    <span className="text-xs text-foreground-muted">
                      {s ? `${s.count} fichier${s.count > 1 ? "s" : ""} · dernier ajout ${formatDate(s.lastAdded)}` : "Aucun fichier"}
                    </span>
                  </Link>
                </li>
              );
            })}
            {sorted.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune entreprise.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
