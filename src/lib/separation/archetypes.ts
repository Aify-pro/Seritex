// Fichier GÉNÉRÉ par scripts/build-reveal-core.mjs (archétypes du moteur Reveal) : ne pas modifier à la main.
export type Archetype = { id: string; nom: string; groupe: string | null; description: string };

export const ARCHETYPES: Archetype[] = [
  {
    "id": "black_and_white",
    "nom": "Black & White",
    "groupe": "soft",
    "description": "Pure grayscale master. Hard-locks neutral centroids to prevent chromatic noise."
  },
  {
    "id": "cinematic",
    "nom": "Cinematic",
    "groupe": "dramatic",
    "description": "Deep tones and heavy shadows. Prevents shadow fusion in low-exposure shots."
  },
  {
    "id": "commercial",
    "nom": "Commercial",
    "groupe": "graphic",
    "description": "High contrast, saturated commercial photography. Optimized for edge-sharpness and vibrant results."
  },
  {
    "id": "cool_recovery",
    "nom": "Cool Recovery",
    "groupe": "specialist",
    "description": "Forces engine to find cool-spectrum outliers in warm or neutral images."
  },
  {
    "id": "dark_portrait",
    "nom": "Dark Portrait",
    "groupe": "dramatic",
    "description": "Dark warm paintings with dramatic light-dark contrast. Low-chroma, orange-dominant, high blackness. Rembrandt-era portraits, candlelit scenes, tenebrism."
  },
  {
    "id": "detail_recovery",
    "nom": "Detail Recovery",
    "groupe": "specialist",
    "description": "Surgical recovery for monochromatic, high-detail images. Prevents saliency shadow."
  },
  {
    "id": "everyday_photo",
    "nom": "Everyday Photo",
    "groupe": "natural",
    "description": "Baseline metrics for standard photographic scenes."
  },
  {
    "id": "faded_vintage",
    "nom": "Faded Vintage",
    "groupe": "soft",
    "description": "Mid-bright, desaturated. Ideal for faded posters and WPA aesthetics."
  },
  {
    "id": "film_noir",
    "nom": "Film Noir",
    "groupe": "dramatic",
    "description": "Dark, high contrast. Optimized for woodcuts and film noir aesthetics."
  },
  {
    "id": "fine_art_scan",
    "nom": "Fine Art Scan",
    "groupe": "natural",
    "description": "Baseline for 16-bit photographic scans. High entropy target protects clinical color diversity."
  },
  {
    "id": "full_spectrum",
    "nom": "Full Spectrum",
    "groupe": "natural",
    "description": "High-entropy images with color spread across many sectors. No dominant hue — treats all colors with equal structural respect. Balanced weights prevent any single channel from hijacking separation."
  },
  {
    "id": "golden_hour",
    "nom": "Golden Hour",
    "groupe": "dramatic",
    "description": "Single warm hue dominates a neutral canvas. High temperature, concentrated orange-yellow sector, low overall chroma from neutral majority. Golden hour scenes, chestnut horses, amber-lit interiors, autumn foliage against dark backgrounds."
  },
  {
    "id": "hot_yellow",
    "nom": "Hot Yellow",
    "groupe": "vibrant",
    "description": "Maximum aggression for high-chroma yellows. Uses a high primary-sector trigger to keep yellows sovereign."
  },
  {
    "id": "minkler",
    "nom": "Minkler",
    "groupe": "graphic",
    "description": "High-contrast graphic posterization with bold blocks of color. Named for Doug Minkler."
  },
  {
    "id": "neon",
    "nom": "Neon",
    "groupe": "graphic",
    "description": "Aggressive hue-locking for saturated flat art. Prevents bleed between vibrant spot colors."
  },
  {
    "id": "old_master",
    "nom": "Old Master",
    "groupe": "dramatic",
    "description": "Very dark warm paintings with golden tonality and compressed dynamic range. Rembrandt portraits, Caravaggio, candlelit old masters where most pixels live in deep shadow with warm yellow-orange bias."
  },
  {
    "id": "painterly",
    "nom": "Painterly",
    "groupe": "natural",
    "description": "Warm-toned painterly scenes with high hue diversity. Complex multi-hue compositions where many sectors contribute — landscapes, genre scenes, Art Nouveau illustrations. Higher entropy than Warm Dramatic; warmer than Subtle Naturalist."
  },
  {
    "id": "pastel",
    "nom": "Pastel",
    "groupe": "soft",
    "description": "Very bright, soft colors. Protects gradients in high-key photography."
  },
  {
    "id": "saturated_max",
    "nom": "Saturated Max",
    "groupe": "vibrant",
    "description": "Hard-coded v1 physics with Mk 1.5 stability. 10-color partition."
  },
  {
    "id": "soft_light",
    "nom": "Soft Light",
    "groupe": "soft",
    "description": "Mid-bright, low contrast. Protects soft gradients in high-key photography."
  },
  {
    "id": "spot_color",
    "nom": "Spot Color",
    "groupe": "graphic",
    "description": "Ultra-flat colors, zero gradients. High hue-locking for surgical separation of spot colors."
  },
  {
    "id": "sunlit",
    "nom": "Sunlit",
    "groupe": "vibrant",
    "description": "Bright warm scenes with dramatic shadows and concentrated hue. High K, high L-std, warm temperature, low entropy. Painted murals, warm-lit architecture, sunlit folk art against dark backgrounds."
  },
  {
    "id": "vivid_photo",
    "nom": "Vivid Photo",
    "groupe": "vibrant",
    "description": "Finds vibrant details without crushing luminance. Balanced c-weight preserves form while boosting chroma."
  },
  {
    "id": "vivid_poster",
    "nom": "Vivid Poster",
    "groupe": "graphic",
    "description": "High-impact graphic style that respects luminance boundaries. Clean lines, bold chroma."
  },
  {
    "id": "warm_photo",
    "nom": "Warm Photo",
    "groupe": "natural",
    "description": "Warm multi-hue subjects (food, toys, wildlife). Orange/red dominant with moderate chroma spread. Requires high entropy (diverse hues) and strong warm temperature bias. Yellow-dominant images belong to thermonuclear_yellow instead."
  }
];
