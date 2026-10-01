/**
 * Montant en toutes lettres (français, orthographe de 1990 non retenue :
 * « quatre-vingts », « deux cents »…) pour la formule « Arrêté la présente
 * proforma à la somme de … » usuelle sur les documents commerciaux
 * ivoiriens. Entiers de 0 à 999 999 999 999 (F CFA, sans décimale).
 */
const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize",
];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

/** 1 à 99. */
function below100(n: number): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return "dix-" + UNITS[n - 10];
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t];
    return TENS[t] + (u === 1 ? " et un" : "-" + UNITS[u]);
  }
  if (n < 80) {
    // 70-79 : soixante-dix… ; 71 = soixante et onze
    const u = n - 60;
    return n === 71 ? "soixante et onze" : "soixante-" + below100(u);
  }
  // 80-99 : quatre-vingt(s)…
  if (n === 80) return "quatre-vingts";
  return "quatre-vingt-" + below100(n - 80);
}

/** 1 à 999. `final` : vrai si ce bloc n'est suivi d'aucun mot-échelle (cent/vingt prennent alors leur s). */
function below1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) {
    if (h === 1) parts.push("cent");
    else parts.push(UNITS[h] + (r === 0 && final ? " cents" : " cent"));
  }
  if (r > 0) {
    // « quatre-vingts » perd son s quand un nombre suit (mille, million…).
    parts.push(r === 80 && !final ? "quatre-vingt" : below100(r));
  }
  return parts.join(" ");
}

export function numberToWordsFr(value: number): string {
  const n = Math.round(value);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "zéro";

  const scales: { size: number; one: string; many: string }[] = [
    { size: 1_000_000_000, one: "milliard", many: "milliards" },
    { size: 1_000_000, one: "million", many: "millions" },
    { size: 1_000, one: "mille", many: "mille" },
  ];

  let rest = n;
  const out: string[] = [];
  for (const { size, one, many } of scales) {
    const q = Math.floor(rest / size);
    rest %= size;
    if (q === 0) continue;
    if (size === 1_000) {
      // « mille » seul, jamais « un mille ».
      out.push(q === 1 ? "mille" : below1000(q, false) + " mille");
    } else {
      out.push(below1000(q, q === 0) + " " + (q === 1 ? one : many));
    }
  }
  if (rest > 0) out.push(below1000(rest, true));
  return out.join(" ");
}

/**
 * « Un million deux cent mille francs CFA » — première lettre en capitale,
 * « franc » au singulier pour 0 et 1, « de francs » après un nombre rond de
 * millions / milliards (deux millions de francs CFA).
 */
export function amountInWordsFr(value: number): string {
  const n = Math.round(value);
  const words = numberToWordsFr(n);
  if (!words) return "";
  const roundMillions = n >= 1_000_000 && n % 1_000_000 === 0;
  const unit = n <= 1 ? "franc CFA" : roundMillions ? "de francs CFA" : "francs CFA";
  const text = `${words} ${unit}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
