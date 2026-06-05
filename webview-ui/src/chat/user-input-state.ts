export interface PendingUserInputState {
  inputId: string
  sessionRunId: string
  kind: string
  message: string
  inputSchema: Record<string, unknown>
  submissionState?: "submitting" | "submit_failed"
  submissionError?: string
}

export type UserInputDraft = Record<string, unknown>

export interface UserInputEnumOption {
  key: string
  label: string
  value: unknown
}

export type UserInputFieldKind = "text" | "number" | "integer" | "boolean" | "select" | "json"

export function userInputFromPayload(
  payload: Record<string, unknown>,
  sessionRunId: string,
): PendingUserInputState {
  return {
    inputId: String(payload.input_id || payload.inputId || ""),
    sessionRunId,
    kind: String(payload.kind || "user_input"),
    message: String(payload.message || payload.title || "MCP request needs input"),
    inputSchema: objectValue(payload.input_schema || payload.inputSchema),
  }
}

export function userInputFieldNames(input: PendingUserInputState): string[] {
  return Object.keys(objectValue(input.inputSchema.properties))
}

export function userInputFieldKind(
  input: PendingUserInputState,
  field: string,
): UserInputFieldKind {
  const schema = userInputFieldSchema(input, field)
  if (Array.isArray(schema.enum)) return "select"
  const type = String(schema.type || "").trim().toLowerCase()
  if (type === "integer") return "integer"
  if (type === "number") return "number"
  if (type === "boolean") return "boolean"
  if (type === "object" || type === "array") return "json"
  return "text"
}

export function userInputEnumOptions(
  input: PendingUserInputState,
  field: string,
): UserInputEnumOption[] {
  const values = userInputFieldSchema(input, field).enum
  if (!Array.isArray(values)) return []
  return values.map((value, index) => ({
    key: String(index),
    label: typeof value === "string" ? value : JSON.stringify(value),
    value,
  }))
}

export function userInputEnumSelectedKey(
  input: PendingUserInputState,
  field: string,
  draft: UserInputDraft,
): string {
  const current = draft[field]
  if (current === undefined || current === null || current === "") return ""
  const options = userInputEnumOptions(input, field)
  const index = options.findIndex((option) => valuesEqual(option.value, current))
  if (index >= 0) return String(index)
  const stringIndex = options.findIndex((option) => String(option.value) === String(current))
  return stringIndex >= 0 ? String(stringIndex) : ""
}

export function userInputDraftDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

export function userInputFieldRequired(
  input: PendingUserInputState,
  field: string,
): boolean {
  return requiredUserInputFields(input).has(field)
}

export function userInputFieldHasDefault(
  input: PendingUserInputState,
  field: string,
): boolean {
  return hasOwn(userInputFieldSchema(input, field), "default")
}

export function userInputBooleanAllowsOmit(
  input: PendingUserInputState,
  field: string,
): boolean {
  return userInputFieldKind(input, field) === "boolean" &&
    !userInputFieldRequired(input, field) &&
    !userInputFieldHasDefault(input, field)
}

export function userInputBooleanSelectedKey(
  input: PendingUserInputState,
  field: string,
  draft: UserInputDraft,
): "" | "true" | "false" {
  const schema = userInputFieldSchema(input, field)
  let raw = hasOwn(draft, field) ? draft[field] : undefined
  if (isEmptyInputValue(raw)) {
    if (hasOwn(schema, "default")) {
      raw = schema.default
    } else if (userInputFieldRequired(input, field)) {
      raw = false
    } else {
      return ""
    }
  }
  return coerceBoolean(raw) ? "true" : "false"
}

export function userInputBooleanValueFromKey(value: string): boolean | undefined {
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

export function buildUserInputContent(
  input: PendingUserInputState,
  draft: UserInputDraft,
): { content: Record<string, unknown>; errors: string[] } {
  const content: Record<string, unknown> = {}
  const errors: string[] = []
  const required = requiredUserInputFields(input)
  for (const field of userInputFieldNames(input)) {
    const schema = userInputFieldSchema(input, field)
    let raw = draft[field]
    if (isEmptyInputValue(raw)) {
      if (hasOwn(schema, "default")) {
        raw = schema.default
      } else if (required.has(field)) {
        if (userInputFieldKind(input, field) === "boolean") {
          raw = false
        } else {
          errors.push(`${field} is required`)
          continue
        }
      } else {
        continue
      }
    }
    const coerced = coerceUserInputValue(field, raw, schema)
    if (coerced.error) {
      errors.push(coerced.error)
      continue
    }
    if (coerced.omit) continue
    content[field] = coerced.value
  }
  return { content: errors.length ? {} : content, errors }
}

export function reconcileStatusUserInputs<T extends PendingUserInputState>(
  items: T[],
  statusUserInputs: unknown[],
  sessionRunId: string,
): T[] {
  const restored = statusUserInputs
    .map((item) => userInputFromPayload(objectValue(item), sessionRunId))
    .filter((item) => item.inputId)
    .filter((item) => {
      const raw = statusUserInputs.find((candidate) => {
        const payload = objectValue(candidate)
        return String(payload.input_id || payload.inputId || "") === item.inputId
      })
      const state = String(objectValue(raw).state || "requested")
      return !state || state === "requested"
    })
  const restoredIds = new Set(restored.map((item) => item.inputId))
  const next = items.filter((item) => {
    if (item.sessionRunId !== sessionRunId) return true
    return restoredIds.has(item.inputId)
  })
  for (const restoredItem of restored) {
    const index = next.findIndex((item) => item.inputId === restoredItem.inputId)
    if (index < 0) {
      next.push(restoredItem as T)
    } else {
      next[index] = { ...next[index], ...restoredItem } as T
    }
  }
  return next
}

export function reconcileStatusUserInputValues(
  current: Record<string, UserInputDraft>,
  statusUserInputs: unknown[],
): Record<string, UserInputDraft> {
  const ids = new Set<string>()
  for (const item of statusUserInputs) {
    const payload = objectValue(item)
    const state = String(payload.state || "requested")
    const inputId = String(payload.input_id || payload.inputId || "")
    if (inputId && (!state || state === "requested")) ids.add(inputId)
  }
  const next: Record<string, UserInputDraft> = {}
  for (const inputId of ids) next[inputId] = current[inputId] || {}
  return next
}

export function visiblePendingUserInputsForRun<T extends PendingUserInputState>(
  items: T[],
  sessionRunId: string | undefined,
): T[] {
  if (!sessionRunId) return []
  return items.filter((item) => item.sessionRunId === sessionRunId)
}

function userInputFieldSchema(
  input: PendingUserInputState,
  field: string,
): Record<string, unknown> {
  return objectValue(objectValue(input.inputSchema.properties)[field])
}

function requiredUserInputFields(input: PendingUserInputState): Set<string> {
  const values = input.inputSchema.required
  return new Set(Array.isArray(values) ? values.map((item) => String(item)) : [])
}

function isEmptyInputValue(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function coerceUserInputValue(
  field: string,
  raw: unknown,
  schema: Record<string, unknown>,
): { value?: unknown; error?: string; omit?: boolean } {
  const enumValues = schema.enum
  if (Array.isArray(enumValues)) {
    if (raw === "") return { omit: true }
    const matched = enumValues.find((item) => valuesEqual(item, raw))
      ?? enumValues.find((item) => String(item) === String(raw))
    if (matched === undefined) return { error: `${field} must match one of the declared options` }
    return { value: matched }
  }
  const type = String(schema.type || "string").trim().toLowerCase()
  if (type === "integer") return coerceNumber(field, raw, true)
  if (type === "number") return coerceNumber(field, raw, false)
  if (type === "boolean") return { value: coerceBoolean(raw) }
  if (type === "object") return coerceJson(field, raw, "object")
  if (type === "array") return coerceJson(field, raw, "array")
  return { value: raw }
}

function coerceNumber(
  field: string,
  raw: unknown,
  integer: boolean,
): { value?: number; error?: string; omit?: boolean } {
  if (raw === "") return { omit: true }
  const value = typeof raw === "number" ? raw : Number(String(raw).trim())
  if (!Number.isFinite(value)) {
    return { error: `${field} must be ${integer ? "an integer" : "a number"}` }
  }
  if (integer && !Number.isInteger(value)) {
    return { error: `${field} must be an integer` }
  }
  return { value }
}

function coerceBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw
  if (typeof raw === "number") return raw !== 0
  const text = String(raw).trim().toLowerCase()
  return !["", "0", "false", "no", "off"].includes(text)
}

function coerceJson(
  field: string,
  raw: unknown,
  expected: "object" | "array",
): { value?: unknown; error?: string; omit?: boolean } {
  if (raw === "") return { omit: true }
  let value = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw)
    } catch {
      return { error: `${field} must be valid JSON ${expected}` }
    }
  }
  if (expected === "array") {
    return Array.isArray(value)
      ? { value }
      : { error: `${field} must be a JSON array` }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? { value }
    : { error: `${field} must be a JSON object` }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
