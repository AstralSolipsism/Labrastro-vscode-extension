import { describe, expect, it } from "vitest"
import { normalizeComplexityPanel } from "./complexity"

describe("normalizeComplexityPanel", () => {
  it("normalizes estimate, repo evidence, missing evidence, and override state", () => {
    const panel = normalizeComplexityPanel({
      estimate: {
        level: "L3",
        score: 24,
        dominant_dimensions: ["interface_impact", "data_impact"],
        unknown_dimensions: ["ops_impact"],
        needs_more_evidence: true,
        explanation: "Repo static analysis contributed formal evidence.",
        required_artifacts: ["api_contract", "migration_plan"],
        required_gates: ["gate-artifact-api_contract"],
        overridden_by: "architect",
        evidence: [
          {
            source_type: "repo_static_analysis",
            source_path: "src/routes/users.ts",
            rationale: "Repo static analysis found API or route surface.",
          },
        ],
      },
    })

    expect(panel.level).toBe("L3")
    expect(panel.score).toBe(24)
    expect(panel.dominantDimensions).toEqual(["interface impact", "data impact"])
    expect(panel.unknownDimensions).toEqual(["ops impact"])
    expect(panel.needsMoreEvidence).toBe(true)
    expect(panel.repoEvidence[0]).toMatchObject({
      path: "src/routes/users.ts",
      rationale: "Repo static analysis found API or route surface.",
    })
    expect(panel.requiredArtifacts).toEqual(["api contract", "migration plan"])
    expect(panel.overrideLabel).toBe("architect")
  })

  it("builds a stable eleven-dimension assessment matrix", () => {
    const panel = normalizeComplexityPanel({
      estimate: {
        dimension_scores: {
          goal_clarity: 1,
          interface_impact: 3,
          data_impact: 2,
        },
        dimension_details: [
          { dimension: "interface_impact", score: 3, evidence_ids: ["repo-api"], rationale: "Public route changed." },
          { dimension: "data_impact", score: 2, evidence_ids: ["repo-migration"], rationale: "Migration found." },
        ],
        dominant_dimensions: ["interface_impact"],
        unknown_dimensions: ["ops_impact"],
      },
    })

    expect(panel.dimensions).toHaveLength(11)
    expect(panel.dimensions.map((item) => item.id)).toEqual([
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
    ])
    expect(panel.dimensions.find((item) => item.id === "interface_impact")).toMatchObject({
      label: "interface impact",
      score: 3,
      dominant: true,
      unknown: false,
      evidenceCount: 1,
      rationale: "Public route changed.",
    })
    expect(panel.dimensions.find((item) => item.id === "ops_impact")).toMatchObject({
      score: 0,
      unknown: true,
    })
  })
})
