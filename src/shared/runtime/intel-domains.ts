const RUNTIME_INFO_DOMAIN_ORDER = ["military", "tech", "ai", "business"] as const;

export const DEFAULT_RUNTIME_INFO_DOMAINS = [...RUNTIME_INFO_DOMAIN_ORDER];

export type RuntimeInfoDomain = (typeof RUNTIME_INFO_DOMAIN_ORDER)[number];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isRuntimeInfoDomain(value: unknown): value is RuntimeInfoDomain {
  return value === "military" || value === "tech" || value === "ai" || value === "business";
}

export function normalizeRuntimeInfoDomain(
  value: unknown,
  fallback: RuntimeInfoDomain = "tech",
): RuntimeInfoDomain {
  const normalized = normalizeText(value);
  if (normalized === "github") {
    return "tech";
  }
  return isRuntimeInfoDomain(normalized) ? normalized : fallback;
}

export function normalizeRuntimeInfoDomainList(
  values: unknown,
  fallback: RuntimeInfoDomain[] = DEFAULT_RUNTIME_INFO_DOMAINS,
): RuntimeInfoDomain[] {
  if (!Array.isArray(values)) {
    return [...fallback];
  }
  const seen = new Set<RuntimeInfoDomain>();
  const output: RuntimeInfoDomain[] = [];
  for (const value of values) {
    const normalized = normalizeRuntimeInfoDomain(value);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output.length > 0 ? output : [...fallback];
}

export function labelRuntimeInfoDomain(domain: RuntimeInfoDomain): string {
  switch (domain) {
    case "military":
      return "Military";
    case "tech":
      return "Tech";
    case "ai":
      return "AI";
    case "business":
      return "Business";
  }
}
