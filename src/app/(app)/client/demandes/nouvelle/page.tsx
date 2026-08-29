import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ClientNewRequestForm } from "./form";

export default async function ClientNewRequestPage() {
  await requireRole(["client"]);

  return (
    <div className="space-y-6">
      <PageHeader title="Nouvelle demande" description="Décrivez votre besoin, un commercial reviendra vers vous." />
      <Card>
        <CardBody>
          <ClientNewRequestForm />
        </CardBody>
      </Card>
    </div>
  );
}
