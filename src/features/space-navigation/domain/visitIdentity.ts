import type {
  NavigatorPhase,
  NavigatorPriority,
  VisitIdentity,
} from "../types";

const BASE_NUMBER_PATTERN = /^(\d+[a-z]+)\d*$/i;
const NORMALIZED_VALUE_CACHE_LIMIT = 4096;
const normalizedNumberCache = new Map<string, string>();
const normalizedBlockCache = new Map<string, string>();

function rememberNormalizedValue(
  cache: Map<string, string>,
  raw: string,
  normalized: string,
): string {
  if (cache.size >= NORMALIZED_VALUE_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(raw, normalized);
  return normalized;
}

/**
 * Normalize only distinctions that are not meaningful to a booth number.
 * Leading zeroes are intentionally preserved because "01" is a display and
 * identity value, not the number 1.
 */
export function normalizeBaseSpaceNumber(value: string): string {
  const cached = normalizedNumberCache.get(value);
  if (cached !== undefined) return cached;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  const match = normalized.match(BASE_NUMBER_PATTERN);
  return rememberNormalizedValue(
    normalizedNumberCache,
    value,
    match ? match[1] : normalized,
  );
}

/** Backwards-friendly name matching the existing spaceGrouping utility. */
export const getBaseNumber = normalizeBaseSpaceNumber;

export function normalizeSpaceBlock(value: string): string {
  const cached = normalizedBlockCache.get(value);
  if (cached !== undefined) return cached;
  return rememberNormalizedValue(
    normalizedBlockCache,
    value,
    value.normalize("NFKC").trim().replace(/\s+/g, " "),
  );
}

export function normalizePriorityLevel(
  value: NavigatorPriority | null | undefined,
): NavigatorPriority {
  return value === "highest" || value === "priority" ? value : "none";
}

export function buildSpaceKey(block: string, number: string): string {
  return `${normalizeSpaceBlock(block)}-${normalizeBaseSpaceNumber(number)}`;
}

export interface BuildVisitIdentityInput {
  block: string;
  number: string;
  priorityLevel?: NavigatorPriority | null;
  phase?: NavigatorPhase;
}

export function buildVisitIdentity(
  input: BuildVisitIdentityInput,
): VisitIdentity {
  const block = normalizeSpaceBlock(input.block);
  const number = normalizeBaseSpaceNumber(input.number);
  const priorityLevel = normalizePriorityLevel(input.priorityLevel);
  const spaceKey = `${block}-${number}`;
  const unphasedId = `${spaceKey}:${priorityLevel}`;

  return {
    id: input.phase ? `${input.phase}:${unphasedId}` : unphasedId,
    spaceKey,
    ...(input.phase ? { phase: input.phase } : {}),
    block,
    number,
    priorityLevel,
  };
}

export function buildVisitId(input: BuildVisitIdentityInput): string {
  return buildVisitIdentity(input).id;
}

export function isSameVisit(
  left: BuildVisitIdentityInput,
  right: BuildVisitIdentityInput,
): boolean {
  return buildVisitId(left) === buildVisitId(right);
}
