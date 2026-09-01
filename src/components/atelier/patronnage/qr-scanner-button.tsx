"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Hypothèse à confirmer avec Ayman : le QR code d'un ODF encode directement
 * sa référence texte (ex. "OF-2026-0123"), sans URL ni JSON autour. Si le
 * format réel diffère, seule la fonction `extractReference` ci-dessous est
 * à adapter — le reste du composant (caméra, détection, cycle de vie) ne
 * change pas.
 */
function extractReference(raw: string): string {
  return raw.trim();
}

// L'API BarcodeDetector n'est pas universellement supportée (absente de
// Firefox et Safari au moment de l'écriture) — on le détecte à l'exécution
// et on affiche un message clair plutôt que de faire semblant que ça marche.
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
    };
  }
}

export function QrScannerButton({ onScanned }: { onScanned: (reference: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const supported = typeof window !== "undefined" && !!window.BarcodeDetector;

  useEffect(() => {
    if (!open || !supported) return;

    let cancelled = false;
    const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });
    const canvas = document.createElement("canvas");

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setError("Impossible d'accéder à la caméra — vérifiez les autorisations, ou utilisez la recherche texte.");
      }
    }

    function tick() {
      if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        detector
          .detect(canvas)
          .then((codes) => {
            if (cancelled) return;
            if (codes.length > 0) {
              onScanned(extractReference(codes[0].rawValue));
              setOpen(false);
              return;
            }
            rafRef.current = requestAnimationFrame(tick);
          })
          .catch(() => {
            rafRef.current = requestAnimationFrame(tick);
          });
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, onScanned, supported]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        title="Scanner le QR code de l'ODF"
        className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-foreground-muted hover:text-foreground"
      >
        <QrCode className="h-3.5 w-3.5" /> QR
      </button>

      <Dialog open={open} onOpenChange={setOpen} title="Scanner le QR code de l'ODF" size="sm">
        <div className="space-y-3">
          {!supported ? (
            <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
              Le scan QR n&apos;est pas pris en charge par ce navigateur — utilisez la recherche texte ci-dessus.
            </div>
          ) : error ? (
            <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
              {error}
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-black">
              <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
            </div>
          )}
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" /> Fermer
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
