import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { executeOperations } from "../op-executor";

function makeStore() {
  return new Store(":memory:");
}

function layerOp(compId: string) {
  return {
    op: "addLayer",
    args: {
      compId,
      layer: { kind: "shape", name: "Box", shape: "rect", width: 100, height: 50 },
    },
  } as const;
}

describe("store", () => {
  it("creates and reads back a seeded project", () => {
    const store = makeStore();
    const project = store.createProject("Intro");
    expect(project.compositions).toHaveLength(1);
    expect(project.compositions[0]!).toMatchObject({ name: "Main", width: 1920, height: 1080, duration: 10 });
    expect(project.compositions[0]!.layers).toHaveLength(0);

    const back = store.getProject(project.id)!;
    expect(back.name).toBe("Intro");
    expect(back).toEqual(project);
    store.close();
  });

  it("edit session lifecycle: step applies to draft only, approve persists to project", () => {
    const store = makeStore();
    const project = store.createProject("P");
    const compId = project.compositions[0]!.id;

    const session = store.createSession(project.id, "add a box")!;
    expect(session.status).toBe("open");
    expect(session.draft.compositions[0]!.layers).toHaveLength(0);

    const { project: draft } = executeOperations(session.draft, [layerOp(compId)]);
    const stepped = store.addSessionStep(session.id, [layerOp(compId)], draft)!;
    expect(stepped.steps).toHaveLength(1);
    expect(stepped.draft.compositions[0]!.layers).toHaveLength(1);

    // the live project must be untouched until approval
    expect(store.getProject(project.id)!.compositions[0]!.layers).toHaveLength(0);

    const approved = store.approveSession(session.id)!;
    expect(approved.session.status).toBe("approved");
    expect(approved.project.compositions[0]!.layers).toHaveLength(1);
    expect(store.getProject(project.id)!.compositions[0]!.layers).toHaveLength(1);
    store.close();
  });

  it("discardSession keeps the project unchanged", () => {
    const store = makeStore();
    const project = store.createProject("P");
    const compId = project.compositions[0]!.id;

    const session = store.createSession(project.id, "try something")!;
    const { project: draft } = executeOperations(session.draft, [layerOp(compId)]);
    store.addSessionStep(session.id, [layerOp(compId)], draft);

    const discarded = store.discardSession(session.id)!;
    expect(discarded.status).toBe("discarded");
    expect(store.getProject(project.id)!.compositions[0]!.layers).toHaveLength(0);
    expect(store.getSession(session.id)!.status).toBe("discarded");
    store.close();
  });

  it("rejects stepping or approving a non-open session", () => {
    const store = makeStore();
    const project = store.createProject("P");
    const compId = project.compositions[0]!.id;

    const session = store.createSession(project.id, "s")!;
    const { project: draft } = executeOperations(session.draft, [layerOp(compId)]);
    store.addSessionStep(session.id, [layerOp(compId)], draft);
    store.approveSession(session.id);

    expect(store.addSessionStep(session.id, [layerOp(compId)], draft)).toBeNull();
    expect(store.approveSession(session.id)).toBeNull();
    store.close();
  });

  it("lists projects and sessions, and deletes projects", () => {
    const store = makeStore();
    const project = store.createProject("A");
    store.createProject("B");
    expect(store.listProjects()).toHaveLength(2);

    store.createSession(project.id, "s1");
    store.createSession(project.id, "s2");
    expect(store.listSessions(project.id)).toHaveLength(2);

    store.deleteProject(project.id);
    expect(store.getProject(project.id)).toBeNull();
    expect(store.listSessions(project.id)).toHaveLength(0);
    expect(store.listProjects()).toHaveLength(1);
    store.close();
  });

  it("saves an externally-provided project document", () => {
    const store = makeStore();
    const project = store.createProject("P");
    const renamed = { ...project, name: "Renamed" };
    store.saveProject(renamed);
    expect(store.getProject(project.id)!.name).toBe("Renamed");
    store.close();
  });
});
