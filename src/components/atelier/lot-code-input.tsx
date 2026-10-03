"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import { QrScannerDialog } from "@/components/atelier/qr-scanner-dialog";

/** QR d'un lot : l'URL /lots/LOT-AAAA-NNNNN, ou le code seul (douchette). */
export const LOT_CODE_PATTERN = /(LOT-\d{4}-\d{5})/i;

/**
 * Code de lot (SF-5) : saisi, lu par une douchette (qui tape comme un
 * clavier) ou scanné à la caméra de la tablette.
 */
export function LotCodeInput({
  value,
  onChange,
  disabled,
  placeholder = "LOT-AAAA-NNNNN",
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-1.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Code du lot"
        className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 font-mono text-sm outline-none focus:ring-2 focus:ring-brand/30"
      />
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Scanner le QR du lot"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-muted"
      >
        <QrCode className="h-4 w-4" />
      </button>
      <QrScannerDialog
        open={open}
        onOpenChange={setOpen}
        title="Scanner le QR du lot"
        description="Visez l'étiquette du lot (ou du colis)."
        pattern={LOT_CODE_PATTERN}
        invalidMessage="QR code reconnu, mais ce n'est pas un lot Seritex."
        onMatch={(code) => {
          setOpen(false);
          onChange(code.toUpperCase());
        }}
      />
    </div>
  );
}
