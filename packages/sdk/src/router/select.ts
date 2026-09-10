export interface Candidate { providerId: string; priceAtomic: bigint; qualityScore: number; successRate: number }
export interface ScoredCandidate extends Candidate { economicCost: number }
export function selectProvider(candidates: Candidate[]): ScoredCandidate {
  if (!candidates.length) throw new RangeError("At least one candidate is required");
  const scored = candidates.map(c => ({ ...c, economicCost: Number(c.priceAtomic) / (c.qualityScore * c.successRate) }));
  return scored.sort((a, b) => a.economicCost - b.economicCost || Number(a.priceAtomic - b.priceAtomic) || a.providerId.localeCompare(b.providerId))[0];
}
