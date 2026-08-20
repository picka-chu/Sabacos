import { describe, expect, it } from "vitest";
import { EventHub } from "../ws-hub";

function fakeSocket(readyState: number) {
  return { OPEN: 1, readyState, sent: [] as string[], send(message: string) { this.sent.push(message); } } as any;
}

describe("EventHub", () => {
  it("broadcasts only to subscribers of the same project", () => {
    const hub = new EventHub();
    const a = fakeSocket(1);
    const b = fakeSocket(1);
    hub.subscribe("p1", a);
    hub.subscribe("p1", b);
    hub.subscribe("p2", a);

    hub.broadcast("p1", { type: "session:update", id: 1 });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0]!)).toMatchObject({ type: "session:update" });

    hub.broadcast("p2", { type: "project:update" });
    expect(a.sent).toHaveLength(2);
    expect(b.sent).toHaveLength(1);

    hub.unsubscribe("p1", a);
    hub.broadcast("p1", { type: "x" });
    expect(a.sent).toHaveLength(2);
    expect(b.sent).toHaveLength(2);
  });

  it("does not send to sockets that are not open", () => {
    const hub = new EventHub();
    const closed = fakeSocket(3);
    hub.subscribe("p1", closed);
    hub.broadcast("p1", { type: "x" });
    expect(closed.sent).toHaveLength(0);
  });
});
