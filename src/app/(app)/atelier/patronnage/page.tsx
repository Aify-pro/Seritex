import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { BookMarked } from "lucide-react";
import { getFichesPlacement } from "@/lib/patronnage/fiches-query";
import { FichesPlacementClient } from "@/components/atelier/patronnage/fiches-placement-client";

export default async function PatronnagePage() {
  const { profile } = await requireUser();
  const [canView, canCreate, canModify, canValidate, canUnlock, canArchive, canDelete] = await Promise.all([
    can("patronnage", "view"),
    can("patronnage", "create"),
    can("patronnage", "modify"),
    can("patronnage", "validate"),
    can("patronnage", "unlock"),
    can("patronnage", "archive"),
    can("patronnage", "delete"),
  ]);
  if (!canView) redirect("/dashboard?erreur=acces_refuse");

  const fiches = await getFichesPlacement();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patronnage"
        description="Fiches de placement : demandes, tracés Diamino déposés et contrôle géométrique — tolérance zéro avant bon pour coupe."
        action={
          <div className="flex items-center gap-2">
            <Link href="/atelier/patronnage/bibliotheque">
              <Button variant="secondary" size="sm">
                <BookMarked className="h-3.5 w-3.5" /> Bibliothèque de patrons
              </Button>
            </Link>
          </div>
        }
      />

      <FichesPlacementClient
        fiches={fiches}
        currentUserRole={profile.role}
        permissions={{ canCreate, canModify, canValidate, canUnlock, canArchive, canDelete }}
      />
    </div>
  );
}
