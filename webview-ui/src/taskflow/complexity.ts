export interface ComplexityPanelState {
  level: string
  score: number | undefined
  confidence: number | undefined
  dimensions: ComplexityDimensionState[]
  dominantDimensions: string[]
  unknownDimensions: string[]
  needsMoreEvidence: boolean
  explanation: string
  requiredArtifacts: string[]
  requiredGates: string[]
  repoEvidence: Array<{ path: string; rationale: string }>
  overrideLabel: string
}

export interface ComplexityDimensionState {
  id: string
  label: string
  score: number
  dominant: boolean
  unknown: boolean
  evidenceCount: number
  rationale: string
}

export const COMPLEXITY_DIMENSIONS = [
  "goal_clarity",
  "acceptance_quality",
  "business_impact",
  "user_count",
  "domain_complexity",
  "technical_risk",
  "interface_impact",
  "data_impact",
  "ops_impact",
  "reversibility",
  "org_collaboration",
]

export function normalizeComplexityPanel(input: unknown): ComplexityPanelState {
  const root = objectValue(input)
  const estimate = objectValue(root.estimate || objectValue(root.complexity).estimate)
  const dominantDimensionIds = new Set(arrayValue(estimate.dominant_dimensions).map((item) => String(item)))
  const unknownDimensionIds = new Set(arrayValue(estimate.unknown_dimensions).map((item) => String(item)))
  const dimensionScores = objectValue(estimate.dimension_scores)
  const dimensionDetails = new Map(
    arrayValue(estimate.dimension_details)
      .map(objectValue)
      .map((item) => [stringValue(item.dimension), item] as const)
      .filter(([dimension]) => Boolean(dimension))
  )
  const evidence = arrayValue(estimate.evidence)
    .map(objectValue)
    .filter((item) => stringValue(item.source_type) === "repo_static_analysis")
    .map((item) => ({
      path: stringValue(item.source_path) || stringValue(objectValue(item.metadata).path),
      rationale: stringValue(item.rationale),
    }))
    .filter((item) => item.path || item.rationale)
  return {
    level: stringValue(estimate.level) || "unknown",
    score: numberValue(estimate.score),
    confidence: numberValue(estimate.confidence),
    dimensions: COMPLEXITY_DIMENSIONS.map((dimension) => {
      const detail = dimensionDetails.get(dimension) || {}
      const score = numberValue(detail.score) ?? numberValue(dimensionScores[dimension]) ?? 0
      const evidenceIds = arrayValue(detail.evidence_ids)
      return {
        id: dimension,
        label: labelize(dimension),
        score,
        dominant: dominantDimensionIds.has(dimension),
        unknown: unknownDimensionIds.has(dimension),
        evidenceCount: evidenceIds.length,
        rationale: stringValue(detail.rationale),
      }
    }),
    dominantDimensions: arrayValue(estimate.dominant_dimensions).map(labelize),
    unknownDimensions: arrayValue(estimate.unknown_dimensions).map(labelize),
    needsMoreEvidence: estimate.needs_more_evidence === true,
    explanation: stringValue(estimate.explanation) || stringValue(estimate.rationale),
    requiredArtifacts: arrayValue(estimate.required_artifacts).map(labelize),
    requiredGates: arrayValue(estimate.required_gates).map(labelize),
    repoEvidence: evidence,
    overrideLabel: stringValue(estimate.overridden_by),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function labelize(value: unknown): string {
  return String(value || "").replace(/_/g, " ").trim()
}
