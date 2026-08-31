import type { Point } from "@/lib/patronnage/geometry";

export interface LibraryPiece {
  id: string;
  name: string;
  expectedCount: number;
  points: Point[];
  area: number;
  perimeter: number;
}

export interface LibraryPattern {
  id: string;
  size: string;
  pieces: LibraryPiece[];
}

export interface LibraryArticle {
  id: string;
  articleCode: string;
  designation: string;
  tolerancePct: number;
  patterns: LibraryPattern[];
}
