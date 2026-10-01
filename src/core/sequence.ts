import type { Base } from "./types.js";

export function normalizeSequence(input: string): string {
  return input.toUpperCase().replace(/\s+/g, "");
}

export function isValidSequence(sequence: string): boolean {
  return sequence.length > 0 && /^[AUGC]+$/.test(sequence);
}

export function bases(sequence: string): Base[] {
  return Array.from(sequence) as Base[];
}
