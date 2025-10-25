export function snapshot (input: unknown): unknown {
  const serializable = toSerializable(input);
  const json = JSON.stringify(serializable);
  return json === undefined ? serializable : JSON.parse(json);
};

function toSerializable (value: unknown, seen = new WeakSet<object>()): unknown  {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Set) return [...value].map((item) => toSerializable(item, seen));
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [key, val] of value.entries()) {
      obj[String(key)] = toSerializable(val, seen);
    }
    return obj;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((item) => toSerializable(item, seen));

  const plain: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    plain[key] = toSerializable(val, seen);
  }
  return plain;
};