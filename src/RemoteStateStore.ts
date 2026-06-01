export type RemoteStateKey =
  | "connection"
  | "providers"
  | "modelProfiles"
  | "chatConfig"
  | "serverSettings"
  | "backendFeatures"
  | "github"
  | "modelCapabilities"
  | "capabilities"
  | "environmentManifest"
  | "environmentSnapshot"

export type RemoteSliceStatus = "idle" | "loading" | "revalidating" | "ready" | "stale" | "error"

export interface RemoteStateSlice {
  status: RemoteSliceStatus
  data?: Record<string, unknown>
  error?: string
  updatedAt?: number
  version: number
  inFlight: boolean
}

export interface RemoteStateSnapshot {
  version: number
  slices: Record<RemoteStateKey, RemoteStateSlice>
}

interface RemoteStateStoreOptions {
  now?: () => number
}

const REMOTE_STATE_KEYS: RemoteStateKey[] = [
  "connection",
  "providers",
  "modelProfiles",
  "chatConfig",
  "serverSettings",
  "backendFeatures",
  "github",
  "modelCapabilities",
  "capabilities",
  "environmentManifest",
  "environmentSnapshot",
]

export class RemoteStateStore {
  private readonly now: () => number
  private readonly slices = new Map<RemoteStateKey, RemoteStateSlice>()
  private readonly inFlight = new Map<RemoteStateKey, Promise<Record<string, unknown>>>()
  private version = 0

  constructor(options: RemoteStateStoreOptions = {}) {
    this.now = options.now || Date.now
    for (const key of REMOTE_STATE_KEYS) {
      this.slices.set(key, {
        status: "idle",
        version: 0,
        inFlight: false,
      })
    }
  }

  snapshot(): RemoteStateSnapshot {
    return {
      version: this.version,
      slices: Object.fromEntries(
        REMOTE_STATE_KEYS.map((key) => [key, this.slice(key)])
      ) as Record<RemoteStateKey, RemoteStateSlice>,
    }
  }

  slice(key: RemoteStateKey): RemoteStateSlice {
    return { ...this.requireSlice(key) }
  }

  setReady(key: RemoteStateKey, data: Record<string, unknown>): RemoteStateSlice {
    return this.updateSlice(key, {
      status: "ready",
      data,
      error: undefined,
      updatedAt: this.now(),
      inFlight: false,
    })
  }

  setError(key: RemoteStateKey, error: unknown): RemoteStateSlice {
    const current = this.requireSlice(key)
    return this.updateSlice(key, {
      status: current.data ? "stale" : "error",
      data: current.data,
      error: errorMessage(error),
      updatedAt: current.updatedAt,
      inFlight: false,
    })
  }

  refresh(
    key: RemoteStateKey,
    loader: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const existing = this.inFlight.get(key)
    if (existing) return existing

    const current = this.requireSlice(key)
    this.updateSlice(key, {
      status: current.data ? "revalidating" : "loading",
      data: current.data,
      error: undefined,
      updatedAt: current.updatedAt,
      inFlight: true,
    })

    const request = loader()
      .then((data) => {
        this.setReady(key, data)
        return data
      })
      .catch((error) => {
        this.setError(key, error)
        throw error
      })
      .finally(() => {
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, request)
    return request
  }

  private requireSlice(key: RemoteStateKey): RemoteStateSlice {
    const slice = this.slices.get(key)
    if (!slice) throw new Error(`Unknown remote state slice: ${key}`)
    return slice
  }

  private updateSlice(
    key: RemoteStateKey,
    patch: Omit<Partial<RemoteStateSlice>, "version">,
  ): RemoteStateSlice {
    const current = this.requireSlice(key)
    this.version += 1
    const next: RemoteStateSlice = {
      ...current,
      ...patch,
      version: this.version,
    }
    this.slices.set(key, next)
    return { ...next }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
