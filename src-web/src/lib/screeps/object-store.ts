function numericStore(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const amount = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(amount) && amount >= 0) result[key] = amount;
  }
  return result;
}

/** The same inventory can appear in modern and legacy fields. Each resource is counted once. */
export function extractObjectStore(record: Record<string, unknown>): Record<string, number> | undefined {
  const output: Record<string, number> = {};
  const store = record.store as { store?: unknown } | undefined;
  const resources = record.resources as { store?: unknown } | undefined;
  for (const candidate of [record.store, store?.store, record.resources, resources?.store]) {
    for (const [resource, amount] of Object.entries(numericStore(candidate))) {
      if (!Object.prototype.hasOwnProperty.call(output, resource)) output[resource] = amount;
    }
  }
  const addFallback = (resource: unknown, raw: unknown) => {
    if (typeof resource !== "string" || !resource || Object.prototype.hasOwnProperty.call(output, resource)) return;
    const amount = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(amount) && amount >= 0) output[resource] = amount;
  };
  addFallback(record.resourceType ?? record.resource, record.amount ?? record.resourceAmount);
  addFallback(record.mineralType, record.mineralAmount);
  for (const resource of ["energy", "power", "ops"]) addFallback(resource, record[resource]);
  addFallback("G", record.ghodium);
  return Object.keys(output).length ? output : undefined;
}
