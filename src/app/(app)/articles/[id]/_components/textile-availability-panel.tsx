import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { TextileAvailabilityForm, type TextileAvailabilityColor } from "./textile-availability-form";

interface Row {
  textile_id: string;
  grammage: number | null;
  color_id: string;
  color_name: string;
  suivi: boolean;
  seuil_kg: number;
  rouleaux: number;
  kg: number;
  statut: TextileAvailabilityColor["statut"];
}

/**
 * Suivi de disponibilité d'un article tissu (onglet Stock) : par grammage, on
 * active le suivi et on règle le seuil ; chaque couleur dit si elle est
 * disponible d'après ses rouleaux. C'est ce qui alimente la disponibilité des
 * produits finis, le signalement en devis et la publication sur l'e-shop.
 */
export async function TextileAvailabilityPanel({ productModelId: id, canModify }: { productModelId: string; canModify: boolean }) {
  const supabase = await createClient();
  const [{ data: textiles }, { data }] = await Promise.all([
    supabase.from("textiles").select("id,grammage,suivi_disponibilite,seuil_disponibilite_kg").eq("product_model_id", id).order("grammage"),
    supabase.rpc("textile_availability", { p_model_id: id }),
  ]);
  const rows = (data ?? []) as Row[];

  return (
    <Card>
      <CardHeader
        title="Disponibilité par grammage et couleur"
        description="Active le suivi une fois les rouleaux de ce grammage saisis : les produits finis qui l'utilisent signalent alors les couleurs manquantes, et l'e-shop ne les propose plus."
      />
      <CardBody className="space-y-3">
        {(textiles ?? []).map((t) => (
          <TextileAvailabilityForm
            key={t.id as string}
            modelId={id}
            textileId={t.id as string}
            grammage={t.grammage == null ? null : Number(t.grammage)}
            suivi={!!t.suivi_disponibilite}
            seuilKg={Number(t.seuil_disponibilite_kg ?? 0)}
            canModify={canModify}
            colors={rows
              .filter((r) => r.textile_id === t.id)
              .map((r) => ({ colorId: r.color_id, name: r.color_name, rouleaux: r.rouleaux, kg: Number(r.kg), statut: r.statut }))}
          />
        ))}
        {(textiles ?? []).length === 0 && <p className="text-sm text-foreground-muted">Aucun tissu relié à cet article.</p>}
      </CardBody>
    </Card>
  );
}
