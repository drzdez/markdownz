// Update check policy (pure helpers, unit tested).

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Automatic checks run at most once per interval. */
export function shouldCheck(lastCheck: number | undefined, now: number, interval = CHECK_INTERVAL_MS): boolean {
  return lastCheck === undefined || now - lastCheck >= interval || now < lastCheck;
}

/** Compares dotted versions ("0.10.0" > "0.9.3"); pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Whether an available version should be offered: newer and not skipped by the user. */
export function shouldOffer(current: string, available: string, skipped: string | undefined): boolean {
  return compareVersions(available, current) > 0 && available !== skipped;
}
