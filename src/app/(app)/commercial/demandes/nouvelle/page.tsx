import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewRequestForm } from "./new-request-form";

export default async function NewRequestPage() {
  await requireRole(["commercial", "administrateur"]);

  return (
    <div className="space-y-6">
      <PageHeader title="Nouvelle demande" description="Saisir une demande reçue par téléphone, e-mail ou en direct." />
      <Card>
        <CardBody>
          <NewRequestForm />
        </CardBody>
      </Card>
    </div>
  );
}
