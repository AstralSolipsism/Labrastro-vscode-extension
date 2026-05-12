import type * as vscode from "vscode"

export type WebviewTarget = "sidebar" | "settings" | "agentManager" | "taskflow"
export type PostMessage = (message: Record<string, unknown>) => Thenable<boolean> | void

interface WebviewRegistration {
  target: WebviewTarget
}

export class WebviewBus {
  private readonly posts = new Map<PostMessage, WebviewRegistration>()

  get size(): number {
    return this.posts.size
  }

  register(target: WebviewTarget, post: PostMessage): vscode.Disposable {
    this.posts.set(post, { target })
    return {
      dispose: () => {
        this.posts.delete(post)
      },
    }
  }

  targetOf(post: PostMessage): WebviewTarget | undefined {
    return this.posts.get(post)?.target
  }

  isTarget(post: PostMessage, targets: readonly WebviewTarget[]): boolean {
    const target = this.targetOf(post)
    return Boolean(target && targets.includes(target))
  }

  hasTargets(targets?: readonly WebviewTarget[]): boolean {
    if (!targets) return this.posts.size > 0
    for (const registration of this.posts.values()) {
      if (targets.includes(registration.target)) return true
    }
    return false
  }

  post(post: PostMessage, payload: Record<string, unknown>): void {
    try {
      const sent = post(payload)
      if (sent && typeof sent.then === "function") {
        void sent.then(undefined, () => {
          this.posts.delete(post)
        })
      }
    } catch {
      this.posts.delete(post)
    }
  }

  broadcast(payload: Record<string, unknown>, targets?: readonly WebviewTarget[]): void {
    for (const [post, registration] of Array.from(this.posts.entries())) {
      if (targets && !targets.includes(registration.target)) continue
      this.post(post, payload)
    }
  }
}
