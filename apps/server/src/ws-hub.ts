import type { WebSocket } from "ws";

/** Broadcasts project-scoped events to connected WebSocket clients. */
export class EventHub {
  private subs = new Map<string, Set<WebSocket>>();

  subscribe(projectId: string, ws: WebSocket): void {
    let set = this.subs.get(projectId);
    if (!set) {
      set = new Set();
      this.subs.set(projectId, set);
    }
    set.add(ws);
  }

  unsubscribe(projectId: string, ws: WebSocket): void {
    const set = this.subs.get(projectId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.subs.delete(projectId);
  }

  broadcast(projectId: string, event: unknown): void {
    const set = this.subs.get(projectId);
    if (!set || set.size === 0) return;
    const message = JSON.stringify(event);
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(message);
    }
  }
}
