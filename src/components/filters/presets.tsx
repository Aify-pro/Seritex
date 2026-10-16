import { can } from "@/lib/auth/permissions";
import { chargerPresets } from "@/lib/presets/serveur";
import type { PresetModule } from "@/lib/presets/modules";
import { PresetBar } from "./preset-bar";

/** Barre de préréglages d'un module, à placer entre l'en-tête de page et les filtres. */
export async function Presets({ module }: { module: PresetModule }) {
  const [presets, canShare] = await Promise.all([chargerPresets(module), can(module, "modify")]);
  return <PresetBar module={module} presets={presets} canShare={canShare} />;
}
