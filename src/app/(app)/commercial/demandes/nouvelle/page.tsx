import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewRequestForm } from "./new-request-form";

export default async function NewRequestPage() {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  const { data: companies } = await supabase.from("companies").select("id,name").order("name");
  const { data: contacts } = await supabase.from("contacts").select("id,company_id,first_name,last_name");

  return (
    <div className="space-y-6">
      <PageHeader title="Nouvelle demande" description="Saisir une demande reçue par téléphone, e-mail ou en direct." />
      <Card>
        <CardBody>
          <NewRequestForm companies={companies ?? []} contacts={contacts ?? []} />
        </CardBody>
      </Card>
    </div>
  );
}
