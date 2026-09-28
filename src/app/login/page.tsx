import Image from "next/image";
import { LoginForm } from "./login-form";
import { ShieldCheck, Workflow, Users } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="grid min-h-screen flex-1 lg:grid-cols-2">
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-brand-foreground lg:flex"
        style={{ background: "linear-gradient(155deg, #002a5e 0%, var(--brand) 55%, #0a5bb8 100%)" }}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-30 blur-3xl"
          style={{ background: "var(--accent)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white opacity-[0.07] blur-3xl"
        />
        <div className="absolute inset-0 opacity-[0.06]">
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 1px, transparent 14px)",
            }}
          />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg shadow-black/20">
            <Image src="/logo-seritex.png" alt="Seritex" width={44} height={44} className="h-10 w-10 object-contain" />
          </div>
        </div>

        <div className="relative space-y-8">
          <h1 className="max-w-md text-3xl font-semibold leading-tight">
            Du devis à l&apos;atelier, une seule plateforme pour piloter la production.
          </h1>
          <ul className="space-y-4 text-sm text-white/85">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Workflow className="h-4 w-4" />
              </span>
              Ordres de fabrication et ordres de travail générés automatiquement selon la gamme
              opératoire de chaque produit.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Users className="h-4 w-4" />
              </span>
              Un espace dédié pour chaque rôle : client, commercial, atelier et direction.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <ShieldCheck className="h-4 w-4" />
              </span>
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
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <Image src="/logo-seritex.png" alt="Seritex" width={72} height={72} className="h-16 w-auto object-contain" priority />
          </div>
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
