import { Shirt } from "lucide-react";

/** Cadre commun des écrans publics de compte (mot de passe oublié, réinitialisation, confirmation de lien). */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2 text-lg font-semibold text-foreground">
          <Shirt className="h-6 w-6 text-brand" />
          Seritex
        </div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-foreground-muted">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
