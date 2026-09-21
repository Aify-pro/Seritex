import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Next.js limite par défaut le corps d'une action serveur à 1 Mo. Un tracé
      // DXF réel dépasse souvent ce seuil et était refusé (413) avant même
      // d'atteindre le moteur, alors que readDxfFile accepte jusqu'à 10 Mo
      // (lib/patronnage/upload.ts). Marge pour l'enveloppe multipart ; chaque
      // action garde sa propre limite de taille de fichier.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
