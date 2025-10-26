const textEncoder = new TextEncoder();

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`)
      .join(',')}}`;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : 'null';
  }

  return JSON.stringify(value);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return textEncoder.encode(canonicalJson(value));
}

export function stableStringify(value: unknown): string {
  return canonicalJson(value);
}
