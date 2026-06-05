// Convert the reader's mixed Arrow / class / bigint shapes into plain,
// JSON-friendly POJOs so the UI tree view and React state never touch a Vector
// or a bigint. Defensive by design — this is a system boundary.

export function plainify(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth > 14) return undefined; // guard against pathological cycles
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => plainify(v, depth + 1));
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "function") continue;
      const pv = plainify(v, depth + 1);
      if (pv !== undefined) out[k] = pv;
    }
    return out;
  }
  return undefined;
}
