import type { RateLimitState } from "./types";

const RATE_LIMIT_KEYS = ["limit", "remaining", "used", "resetAt", "resource"] as const;

export const isInformativeRateLimit = (
  value: RateLimitState | null | undefined,
): value is RateLimitState => Boolean(value && RATE_LIMIT_KEYS.some((key) => value[key] !== null));

const informationScore = (value: RateLimitState): number =>
  RATE_LIMIT_KEYS.filter((key) => value[key] !== null).length;

const laterReset = (left: string, right: string): string => {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return rightTime > leftTime ? right : left;
};

const preferMoreInformative = (current: RateLimitState, candidate: RateLimitState): RateLimitState => {
  const currentScore = informationScore(current);
  const candidateScore = informationScore(candidate);
  if (candidateScore > currentScore) return candidate;
  if (candidateScore < currentScore) return current;

  if (current.resetAt && candidate.resetAt && current.resetAt !== candidate.resetAt) {
    return laterReset(current.resetAt, candidate.resetAt) === candidate.resetAt ? candidate : current;
  }

  return current;
};

/**
 * Retains the most useful rate-limit observation seen during a synchronization.
 * Requests in the same resource/reset window are merged monotonically: remaining
 * can only decrease and used can only increase, regardless of completion order.
 */
export const mergeRateLimitState = (
  current: RateLimitState | null | undefined,
  candidate: RateLimitState | null | undefined,
): RateLimitState | null => {
  if (!isInformativeRateLimit(candidate)) {
    return isInformativeRateLimit(current) ? current : null;
  }
  if (!isInformativeRateLimit(current)) return candidate;

  const resourcesConflict = current.resource !== null && candidate.resource !== null &&
    current.resource !== candidate.resource;
  const resetsConflict = current.resetAt !== null && candidate.resetAt !== null &&
    current.resetAt !== candidate.resetAt;
  if (resourcesConflict || resetsConflict) return preferMoreInformative(current, candidate);

  return {
    limit: candidate.limit ?? current.limit,
    remaining: current.remaining === null
      ? candidate.remaining
      : candidate.remaining === null
        ? current.remaining
        : Math.min(current.remaining, candidate.remaining),
    used: current.used === null
      ? candidate.used
      : candidate.used === null
        ? current.used
        : Math.max(current.used, candidate.used),
    resetAt: candidate.resetAt ?? current.resetAt,
    resource: candidate.resource ?? current.resource,
  };
};
