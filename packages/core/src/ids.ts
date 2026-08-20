let counter = 0;

/** Collision-resistant id generator (crypto random + monotonic counter). */
export function createId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  counter = (counter + 1) % 0xffff;
  return `${prefix}_${rand}${counter.toString(36)}`;
}
