/** Romanian plural forms: 1 zi · 2–19 zile · 20+ "de zile" (also 101–119 → zile). */
export function ro(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return `${n} ${one}`;
  const r = a % 100;
  return a === 0 || (r >= 1 && r <= 19) ? `${n} ${few}` : `${n} de ${many}`;
}
export const en = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
