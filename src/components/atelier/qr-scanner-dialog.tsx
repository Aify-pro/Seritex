"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";

/**
 * Lecteur de QR code générique, extrait de `QrScanButton` (file de section)
 * pour être partagé avec le scan d'un sac de déchets. La mécanique caméra
 * (getUserMedia, boucle requestAnimationFrame + jsQR, arrêt des pistes) ne
 * vit qu'ici : la dupliquer, c'était risquer qu'une des deux copies oublie
 * `track.stop()` et laisse la caméra allumée — sur un téléphone d'atelier
 * c'est la batterie de la journée.
 *
 * `jsqr` est chargé dynamiquement : c'est ~40 ko qui n'ont rien à faire dans
 * le bundle initial d'un écran dont le scan n'est qu'une action parmi
 * d'autres.
 *
 * `pattern` doit capturer en groupe 1 la valeur utile du QR (identifiant
 * d'ODF, code de sac...). Un QR lisible mais hors sujet affiche
 * `invalidMessage` sans fermer le lecteur : l'opérateur vise le bon.
 */
export function QrScannerDialog({
  open,
  onOpenChange,
  title,
  description,
  pattern,
  onMatch,
  invalidMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  pattern: RegExp;
  /** Reçoit le groupe 1 du `pattern`. À charge de l'appelant de refermer le lecteur. */
  onMatch: (captured: string) => void;
  invalidMessage: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  // Gardé dans une ref : `onMatch` est presque toujours une closure recréée à
  // chaque rendu, et la mettre en dépendance de l'effet relancerait la caméra
  // à chaque frappe de l'utilisateur dans le formulaire parent. La ref se met
  // à jour après le rendu, jamais pendant.
  const onMatchRef = useRef(onMatch);
  useEffect(() => {
    onMatchRef.current = onMatch;
  });

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
        const { default: jsQR } = await import("jsqr");
        if (cancelled) return;
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
            const match = code.data.match(pattern);
            if (match?.[1]) {
              onMatchRef.current(match[1]);
              return;
            }
            setError(invalidMessage);
          }
          frameRef.current = requestAnimationFrame(tick);
        }

        tick();
      } catch {
        // getUserMedia exige un contexte sécurisé : HTTPS en production
        // Vercel, mais un test depuis un téléphone sur http://<ip-locale>
        // échouera ici sans que le navigateur demande quoi que ce soit.
        setError(
          "Impossible d'accéder à la caméra — vérifiez l'autorisation du navigateur (et que la page est bien en HTTPS)."
        );
      }
    }

    start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, pattern, invalidMessage, stop]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="md">
      <div className="space-y-3">
        <video ref={videoRef} muted playsInline className="aspect-square w-full rounded-md bg-black object-cover" />
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-foreground-muted">Visez le QR code — la lecture est automatique.</p>
      </div>
    </Dialog>
  );
}
