import { constants as fsConstants } from "fs"
import { access, mkdir, stat } from "fs/promises"
import path from "path"
import { spawn } from "child_process"
import type { JsonObject, LabrastroRemoteClient } from "./LabrastroRemoteClient"

interface CapabilityPackageLocalPeerRunnerOptions {
  client: Pick<LabrastroRemoteClient, "capabilityPackageInstallPlan" | "capabilityPackageInstallResult">
  storageRoot: string
  intervalMs?: number
}

type TimerHandle = ReturnType<typeof setInterval>

export class CapabilityPackageLocalPeerRunner {
  private timer: TimerHandle | undefined
  private running: Promise<void> | undefined
  private readonly intervalMs: number

  constructor(private readonly options: CapabilityPackageLocalPeerRunnerOptions) {
    this.intervalMs = Math.max(5_000, options.intervalMs ?? 60_000)
  }

  start(): void {
    if (this.timer) return
    void this.runOnce().catch(() => undefined)
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined)
    }, this.intervalMs)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  dispose(): void {
    this.stop()
  }

  async runOnce(): Promise<void> {
    if (this.running) return this.running
    this.running = this.runPlan().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async runPlan(): Promise<void> {
    const payload = await this.options.client.capabilityPackageInstallPlan()
    const plan = objectValue(payload.plan)
    const planId = stringValue(plan.plan_id || plan.planId)
    const peerStatusActions = objectValue(objectValue(payload.peer_status || payload.peerStatus).actions)
    for (const action of recordArray(plan.actions)) {
      if (stringValue(action.target) !== "local_peer") continue
      if (actionAlreadyInstalled(planId, action, peerStatusActions)) continue
      const result = await this.executeAction(planId, action).catch((error) =>
        this.result(planId, action, "failed", {
          reason: "local_action_failed",
          message: errorMessage(error),
        })
      )
      await this.options.client.capabilityPackageInstallResult(result)
    }
  }

  private async executeAction(planId: string, action: JsonObject): Promise<JsonObject> {
    const actionType = stringValue(action.type)
    if (actionType === "check_executable") {
      return this.checkExecutable(planId, action)
    }
    if (actionType === "install_python_packages") {
      return this.installPythonPackages(planId, action)
    }
    return this.result(planId, action, "blocked", {
      reason: "local_action_not_implemented",
      action_type: actionType,
    })
  }

  private async checkExecutable(planId: string, action: JsonObject): Promise<JsonObject> {
    const params = objectValue(action.params)
    const executable = stringValue(params.executable)
    if (!executable) {
      return this.result(planId, action, "failed", { reason: "executable_required" })
    }
    const foundPath = await findExecutable(executable)
    return this.result(
      planId,
      action,
      foundPath ? "passed" : "missing",
      {
        executable,
        ...(foundPath ? { path: foundPath } : {}),
      }
    )
  }

  private async installPythonPackages(planId: string, action: JsonObject): Promise<JsonObject> {
    const params = objectValue(action.params)
    const packages = stringArray(params.packages)
    if (!packages.length) {
      return this.result(planId, action, "failed", { reason: "python_packages_required" })
    }
    const python = await findFirstExecutable([
      stringValue(params.python),
      "python",
      "python3",
    ])
    if (!python) {
      return this.result(planId, action, "missing", { reason: "python_not_found" })
    }
    const runtimePath = path.join(
      this.options.storageRoot || process.cwd(),
      "capability-packages",
      safePathSegment(stringValue(action.package_id || params.package_id) || "package"),
      "python"
    )
    await mkdir(path.dirname(runtimePath), { recursive: true })
    await runProcess(python, ["-m", "venv", runtimePath])
    const runtimePython = process.platform === "win32"
      ? path.join(runtimePath, "Scripts", "python.exe")
      : path.join(runtimePath, "bin", "python")
    await runProcess(runtimePython, ["-m", "pip", "install", ...packages])
    return this.result(planId, action, "passed", {
      runtime_path: runtimePath,
      packages,
    })
  }

  private result(
    planId: string,
    action: JsonObject,
    status: string,
    details: JsonObject,
  ): JsonObject {
    const params = objectValue(action.params)
    return stripUndefined({
      plan_id: stringValue(action.plan_id || action.planId) || planId,
      action_id: stringValue(action.action_id || action.id),
      package_id: stringValue(action.package_id || params.package_id),
      component_id: stringValue(action.component_id || params.component_id),
      target: "local_peer",
      status,
      content_hash: stringValue(
        action.content_hash ||
        action.expected_content_hash ||
        params.content_hash ||
        params.expected_content_hash
      ),
      timestamp: new Date().toISOString(),
      details,
    })
  }
}

async function findFirstExecutable(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) continue
    const found = await findExecutable(candidate)
    if (found) return found
  }
  return undefined
}

async function findExecutable(executable: string): Promise<string | undefined> {
  const value = executable.trim()
  if (!value) return undefined
  if (value.includes("/") || value.includes("\\") || path.isAbsolute(value)) {
    return (await isUsableFile(value)) ? value : undefined
  }
  const pathValues = String(process.env.PATH || "").split(path.delimiter).filter(Boolean)
  const extensions = process.platform === "win32"
    ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter(Boolean)
    : [""]
  for (const directory of pathValues) {
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" && path.extname(value) ? value : `${value}${extension}`)
      if (await isUsableFile(candidate)) return candidate
    }
  }
  return undefined
}

async function isUsableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return false
    await access(filePath, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`))
    })
  })
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

function safePathSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned || "package"
}

function actionAlreadyInstalled(
  planId: string,
  action: JsonObject,
  peerStatusActions: JsonObject,
): boolean {
  const status = objectValue(peerStatusActions[installActionKey(planId, action)])
  const installState = stringValue(status.install_state || status.installState).toLowerCase()
  const checkState = stringValue(status.check_state || status.checkState).toLowerCase()
  return installState === "installed" && (!checkState || checkState === "passed")
}

function installActionKey(planId: string, action: JsonObject): string {
  const params = objectValue(action.params)
  return [
    stringValue(action.package_id || action.packageId || params.package_id || params.packageId),
    stringValue(action.plan_id || action.planId || params.plan_id || params.planId) || planId,
    stringValue(action.action_id || action.actionId || action.id || params.action_id || params.actionId || params.id),
    stringValue(action.component_id || action.componentId || params.component_id || params.componentId),
  ].join("|")
}

function stripUndefined(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
