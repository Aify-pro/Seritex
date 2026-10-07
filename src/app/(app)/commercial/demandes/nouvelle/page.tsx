import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { getRequestModelOptions } from "@/lib/requests/articles";
import { getDispatchRules } from "@/lib/quote-dispatch";
import { NewRequestForm } from "./new-request-form";

export default async function NewRequestPage() {
  const { profile } = await requireRole(["commercial", "administrateur", "responsable_production"]);
  const [models, dispatchRules] = await Promise.all([getRequestModelOptions(), getDispatchRules()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouvelle demande"
        description="Une demande client (téléphone, e-mail, en direct) ou une demande pour le stock. Les articles choisis sont repris dans le devis ou l'ODF."
      />
      <Card>
        <CardBody>
          {/* La production ne crée que des demandes pour le stock. */}
          <NewRequestForm models={models} dispatchRules={dispatchRules} stockOnly={profile.role === "responsable_production"} />
        </CardBody>
      </Card>
    </div>
  );
}
