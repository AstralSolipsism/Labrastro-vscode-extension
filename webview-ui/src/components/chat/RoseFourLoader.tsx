import { Component, For } from "solid-js"

interface RoseFourLoaderProps {
  class?: string
  title?: string
}

interface RoseParticle {
  staticX: string
  staticY: string
  radius: string
  opacity: string
  begin: string
}

const PARTICLE_COUNT = 16
const PATH_STEPS = 156
const TRAIL_SPAN = 0.42
const DURATION_SECONDS = 4.8
const ORBIT_RADIUS = 7
const DETAIL_AMPLITUDE = 2.7
const PETAL_COUNT = 7
const CURVE_SCALE = 3.9

function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1
}

function rosePoint(progress: number, detailScale = 0.82) {
  const t = progress * Math.PI * 2
  const r = ORBIT_RADIUS - DETAIL_AMPLITUDE * detailScale * Math.cos(PETAL_COUNT * t)

  return {
    x: 50 + Math.cos(t) * r * CURVE_SCALE,
    y: 50 + Math.sin(t) * r * CURVE_SCALE,
  }
}

function buildRosePath(steps = PATH_STEPS): string {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const point = rosePoint(index / steps)
    return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }).join(" ")
}

function buildRoseParticles(): RoseParticle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const tailOffset = index / (PARTICLE_COUNT - 1)
    const point = rosePoint(normalizeProgress(-tailOffset * TRAIL_SPAN))
    const fade = Math.pow(1 - tailOffset, 0.56)
    const begin = index === 0
      ? "0s"
      : `${(-DURATION_SECONDS * (1 - tailOffset * TRAIL_SPAN)).toFixed(3)}s`

    return {
      staticX: point.x.toFixed(2),
      staticY: point.y.toFixed(2),
      radius: (1.4 + fade * 4.2).toFixed(2),
      opacity: (0.16 + fade * 0.84).toFixed(3),
      begin,
    }
  })
}

export const ROSE_PATH = buildRosePath()
export const ROSE_PARTICLES = buildRoseParticles()

export const RoseFourLoader: Component<RoseFourLoaderProps> = (props) => (
  <span class={`rose-loader ${props.class || ""}`} title={props.title} aria-hidden="true">
    <svg class="rose-loader__svg" viewBox="0 0 100 100" fill="none">
      <g class="rose-loader__motion">
        <For each={ROSE_PARTICLES}>
          {(particle) => (
            <circle
              class="rose-loader__particle"
              cx="0"
              cy="0"
              r={particle.radius}
              fill="currentColor"
              opacity={particle.opacity}
            >
              <animateMotion
                dur={`${DURATION_SECONDS}s`}
                begin={particle.begin}
                repeatCount="indefinite"
                path={ROSE_PATH}
              />
            </circle>
          )}
        </For>
      </g>
      <g class="rose-loader__static">
        <For each={ROSE_PARTICLES}>
          {(particle) => (
            <circle
              class="rose-loader__particle"
              cx={particle.staticX}
              cy={particle.staticY}
              r={particle.radius}
              fill="currentColor"
              opacity={particle.opacity}
            />
          )}
        </For>
      </g>
    </svg>
  </span>
)
