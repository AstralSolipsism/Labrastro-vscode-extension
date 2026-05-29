import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./RoseFourLoader.tsx", import.meta.url), "utf8")
const css = readFileSync(new URL("../../styles/chat.css", import.meta.url), "utf8")

describe("RoseFourLoader", () => {
  it("uses static SVG markup without per-frame JavaScript animation", () => {
    expect(source).toContain("export const RoseFourLoader")
    expect(source).toContain("ROSE_PATH")
    expect(source).toContain("ROSE_PARTICLES")
    expect(source).not.toContain("requestAnimationFrame")
    expect(source).not.toContain("setInterval")
    expect(source).not.toContain("<script")
    expect(source).not.toContain("http://")
    expect(source).not.toContain("https://")
  })

  it("keeps the chat loader fixed-size and reduced-motion safe", () => {
    expect(css).toContain(".rose-loader")
    expect(css).toContain("width: 16px")
    expect(css).toContain("height: 16px")
    expect(css).toContain("flex: 0 0 16px")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    expect(css).toContain(".rose-loader__motion")
    expect(css).toContain(".rose-loader__particle")
    expect(css).toContain("animation: none")
  })

  it("uses the more legible Rose Orbit geometry for the small chat icon", () => {
    expect(source).toContain("const ORBIT_RADIUS = 7")
    expect(source).toContain("const DETAIL_AMPLITUDE = 2.7")
    expect(source).toContain("const PETAL_COUNT = 7")
    expect(source).toContain("const CURVE_SCALE = 3.9")
    expect(source).not.toContain("Math.cos(4 * t)")
  })

  it("keeps the small SVG transparent and avoids non-scaling strokes that blur the track", () => {
    expect(css).toContain("background: transparent")
    expect(css).not.toContain("vector-effect: non-scaling-stroke")
  })

  it("moves particles along the Rose Orbit path instead of rotating a visible full-track drawing", () => {
    expect(source).toContain("<animateMotion")
    expect(source).toContain("path={ROSE_PATH}")
    expect(source).toContain("repeatCount=\"indefinite\"")
    expect(source).toContain("class=\"rose-loader__motion\"")
    expect(source).toContain("class=\"rose-loader__static\"")
    expect(source).not.toContain("class=\"rose-loader__orbit\"")
    expect(source).not.toContain("class=\"rose-loader__path\"")
    expect(css).not.toContain("rose-loader-rotate")
    expect(css).not.toContain(".rose-loader__path")
  })
})
