import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isViewType, resolveNavigateViewState } from "./appNavigation"

const appSourcePath = join(process.cwd(), "webview-ui", "src", "App.tsx")
const appCssPath = join(process.cwd(), "webview-ui", "src", "styles", "main.css")

describe("App webview route navigation", () => {
  it("accepts every supported route from navigate messages", () => {
    expect(resolveNavigateViewState({ type: "navigate", view: "settings", tab: "providers" })).toMatchObject({
      currentView: "settings",
      settingsTab: "providers",
      isPanelMode: true,
    })
    expect(resolveNavigateViewState({ type: "navigate", view: "about" })).toMatchObject({
      currentView: "about",
      isPanelMode: true,
    })
    expect(resolveNavigateViewState({
      type: "navigate",
      view: "agentManager",
      nodeId: "node-1",
      branchId: "branch-1",
      sessionId: "session-1",
      intent: "inspect",
    })).toMatchObject({
      currentView: "agentManager",
      panelNodeId: "node-1",
      panelBranchId: "branch-1",
      panelSessionId: "session-1",
      panelIntent: "inspect",
      isPanelMode: true,
    })
    expect(resolveNavigateViewState({ type: "navigate", view: "taskflow", taskflowId: "tf-1" })).toMatchObject({
      currentView: "taskflow",
      panelTaskflowId: "tf-1",
      isPanelMode: true,
    })
  })

  it("rejects unknown navigate views before they can blank the webview", () => {
    expect(isViewType("settings")).toBe(true)
    expect(isViewType("unknown")).toBe(false)
    expect(resolveNavigateViewState({ type: "navigate", view: "unknown" } as any)).toBeUndefined()
  })

  it("keeps SettingsView in the main webview bundle", () => {
    const source = readFileSync(appSourcePath, "utf8")

    expect(source).toContain('import SettingsView from "./components/SettingsView"')
    expect(source).not.toContain('const SettingsView = lazy(() => import("./components/SettingsView"))')
  })

  it("wraps every non-chat route in a route-level error boundary", () => {
    const source = readFileSync(appSourcePath, "utf8")

    expect(source).toContain("<ErrorBoundary fallback={(error) => <RouteErrorFallback")
    expect(source).toContain('<RouteBoundary title={ROUTE_TITLES.settings}>')
    expect(source).toContain('<RouteBoundary title={ROUTE_TITLES.about} suspense>')
    expect(source).toContain('<RouteBoundary title={ROUTE_TITLES.agentManager} suspense>')
    expect(source).toContain('<RouteBoundary title={ROUTE_TITLES.taskflow} suspense>')
  })

  it("keeps lazy route fallbacks visible instead of rendering null", () => {
    const source = readFileSync(appSourcePath, "utf8")
    const css = readFileSync(appCssPath, "utf8")

    expect(source).not.toContain("fallback={null}")
    expect(source).toContain('<Suspense fallback={<RouteLoading title={props.title} />}>')
    expect(source).toContain("route-state--loading")
    expect(source).toContain("route-state--error")
    expect(css).toContain(".route-state--loading")
    expect(css).toContain(".route-state--error")
  })
})
