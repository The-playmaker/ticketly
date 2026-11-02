/**
 * Guards against non-serializable values crossing the RSC → Client Component boundary.
 * Next.js / React Flight cannot pass Date, Map, Set, class instances, etc.
 * Violations surface in production as React minified error #441.
 */

export type ClientPropViolation = { path: string; reason: string };

export function findClientPropViolations(
  value: unknown,
  path = "root"
): ClientPropViolation[] {
  if (value == null) return [];
  const t = typeof value;
  if (t === "string" || t === "boolean" || t === "number") return [];
  if (t === "bigint") return [{ path, reason: "bigint is not serializable" }];
  if (t === "function" || t === "symbol") {
    return [{ path, reason: `${t} is not serializable` }];
  }
  if (t !== "object") return [{ path, reason: `unsupported type ${t}` }];

  if (value instanceof Date) {
    return [{ path, reason: "Date objects are not supported — use toISOString()" }];
  }
  if (value instanceof Map || value instanceof Set) {
    return [{ path, reason: `${value.constructor.name} is not serializable` }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findClientPropViolations(item, `${path}[${i}]`));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return [
      {
        path,
        reason: `non-plain object (${Object.prototype.toString.call(value)})`,
      },
    ];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    findClientPropViolations(child, `${path}.${key}`)
  );
}

export function assertClientPropsSerializable(value: unknown, label = "client props"): void {
  const violations = findClientPropViolations(value);
  if (violations.length === 0) return;
  const detail = violations.map((v) => `${v.path}: ${v.reason}`).join("; ");
  throw new Error(`${label} are not Flight-serializable (${detail})`);
}
