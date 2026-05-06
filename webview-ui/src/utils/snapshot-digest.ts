export const SNAPSHOT_DEBOUNCE_MS = 2500
export const SNAPSHOT_MAX_INTERVAL_MS = 15000

function stableStringify(value: unknown): string {
  if (value === null) return "null"

  const valueType = typeof value
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  if (valueType === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`
  }

  return "null"
}

export function snapshotDigest(value: unknown): string {
  const input = stableStringify(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`
}
