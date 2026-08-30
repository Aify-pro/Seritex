import { LoginForm } from "./login-form";
import { Shirt, ShieldCheck, Workflow, Users } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="grid min-h-screen flex-1 lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand p-10 text-brand-foreground lg:flex">
        <div className="absolute inset-0 opacity-[0.08]">
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 1px, transparent 14px)",
            }}
          />
        </div>
        <div className="relative flex items-center gap-2 text-lg font-semibold">
          <Shirt className="h-6 w-6" />
          Seritex
        </div>

        <div className="relative space-y-8">
          <h1 className="max-w-md text-3xl font-semibold leading-tight">
            Du devis à l&apos;atelier, une seule plateforme pour piloter la production.
          </h1>
          <ul className="space-y-4 text-sm text-white/85">
            <li className="flex items-start gap-3">
              <Workflow className="mt-0.5 h-5 w-5 shrink-0" />
              Ordres de fabrication et ordres de travail générés automatiquement selon la gamme
              opératoire de chaque produit.
            </li>
            <li className="flex items-start gap-3">
              <Users className="mt-0.5 h-5 w-5 shrink-0" />
              Un espace dédié pour chaque rôle : client, commercial, atelier et direction.
            </li>
            <li className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              Accès cloisonnés et vérifiés côté serveur — chaque client et chaque section ne voit
              que ce qui le concerne.
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          © 2026 Seritex — plateforme interne, usage réservé aux comptes autorisés.
        </p>
      </div>

      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold text-foreground lg:hidden">
            <Shirt className="h-6 w-6 text-brand" />
            Seritex
          </div>
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
