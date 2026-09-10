export interface Candidate { providerId: string; priceAtomic: bigint; qualityScore: number; successRate: number }
export interface ScoredCandidate extends Candidate { economicCost: number }
export function selectProvider(candidates: Candidate[]): ScoredCandidate {
  if (!candidates.length) throw new RangeError("At least one candidate is required");
  const scored = candidates.map(c => ({ ...c, economicCost: Number(c.priceAtomic) / (c.qualityScore * c.successRate) }));
  return scored.sort((a, b) => {
    if (a.economicCost !== b.economicCost) {
      return a.economicCost - b.economicCost;
    }
    if (a.priceAtomic !== b.priceAtomic) {
      return a.priceAtomic < b.priceAtomic ? -1 : 1;
    }
    return a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0;
  })[0];
}
