"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { QrCode } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Le QR d'en-tête de l'ODF pointe vers /atelier/production/[id], une page
// interdite au chef de section (requireRole ne l'y autorise pas). Le scan
// n'y navigue donc jamais : on extrait juste l'identifiant de l'ODF du texte
// décodé et on redirige directement vers la file de sa propre section,
// filtrée sur cet ODF — /atelier/section?odf=<id>.
const ODF_ID_PATTERN = /\/atelier\/production\/([0-9a-fA-F-]{36})/;

export function QrScanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }

    let cancelled = false;

    async function start() {
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        canvasRef.current ??= document.createElement("canvas");
        tick();
      } catch {
        setError("Impossible d'accéder à la caméra — vérifiez l'autorisation dans le navigateur.");
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        const match = code.data.match(ODF_ID_PATTERN);
        if (match) {
          setOpen(false);
          router.push(`/atelier/section?odf=${match[1]}`);
          return;
        }
        setError("QR code reconnu, mais il ne correspond pas à un ODF Seritex.");
      }
      frameRef.current = requestAnimationFrame(tick);
    }

    start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, router, stop]);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <QrCode className="h-4 w-4" />
        Scanner un ODF
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Scanner le QR code de l'ODF"
        description="Visez le QR code imprimé en en-tête du bon de fabrication."
      >
        <div className="space-y-3">
          <video ref={videoRef} muted playsInline className="w-full rounded-md bg-black" />
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </Dialog>
    </>
  );
}
