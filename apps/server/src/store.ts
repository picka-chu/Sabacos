import { DatabaseSync } from "node:sqlite";
import {
  addComposition,
  addMedia,
  createComposition,
  createId,
  createMedia,
  createProject,
  parseProject,
  removeMedia,
  type MediaAsset,
  type Project,
} from "@motion/core";
import type { Operation } from "./op-executor";

export type SessionStatus = "open" | "approved" | "discarded";

export type ReferenceStatus = "importing" | "downloading" | "analyzing" | "transcribing" | "ready" | "failed";

export type ReferenceStyleCard = {
  duration: number;
  fps: number;
  width: number;
  height: number;
  cuts: number;
  avgShotLength: number;
  pace: "slow" | "steady" | "fast";
  palette: { hex: string; weight: number }[];
  avgLuminance: number;
  motion: number;
};

export type ReferenceTranscript = {
  language?: string;
  segments: { start: number; end: number; text: string }[];
};

export type Reference = {
  id: string;
  projectId: string;
  title: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  kind: "video" | "audio";
  status: ReferenceStatus;
  error: string | null;
  fileUrl: string | null;
  posterUrl: string | null;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  transcript: ReferenceTranscript | null;
  style: ReferenceStyleCard | null;
  mediaId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EditSession = {
  id: string;
  projectId: string;
  description: string;
  status: SessionStatus;
  /** Current proposed document. */
  draft: Project;
  /** The approved project as it was when the session opened (baseline). */
  baseProject: Project;
  /** Log of operation batches applied so far. */
  steps: { at: string; operations: Operation[] }[];
  createdAt: string;
  updatedAt: string;
};

type SessionRow = {
  id: string;
  project_id: string;
  description: string;
  status: SessionStatus;
  draft: string;
  base_project: string;
  steps: string;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  data: string;
  created_at: string;
  updated_at: string;
};

type ReferenceRow = {
  id: string;
  project_id: string;
  title: string;
  source_url: string | null;
  source_platform: string | null;
  kind: "video" | "audio";
  status: ReferenceStatus;
  error: string | null;
  file_url: string | null;
  poster_url: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  fps: number | null;
  transcript: string | null;
  style: string | null;
  media_id: string | null;
  created_at: string;
  updated_at: string;
};

function now(): string {
  return new Date().toISOString();
}

/** SQLite-backed store for projects and edit sessions (Node's built-in node:sqlite). */
export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        draft TEXT NOT NULL,
        base_project TEXT NOT NULL,
        steps TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE TABLE IF NOT EXISTS "references" (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_url TEXT,
        source_platform TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        file_url TEXT,
        poster_url TEXT,
        width INTEGER,
        height INTEGER,
        duration REAL,
        fps REAL,
        transcript TEXT,
        style TEXT,
        media_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_refs_project ON "references"(project_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  // ----- Projects -----

  createProject(name = "Untitled Project"): Project {
    let project = createProject({ name });
    project = addComposition(
      project,
      createComposition({ name: "Main", width: 1920, height: 1080, fps: 30, duration: 10 }),
    );
    this.saveProject(project);
    return project;
  }

  saveProject(project: Project): void {
    const ts = project.updatedAt || now();
    const createdAt =
      project.createdAt ||
      (this.db.prepare("SELECT created_at FROM projects WHERE id = ?").get(project.id) as ProjectRow | undefined)
        ?.created_at ||
      ts;
    const normalized = { ...project, createdAt, updatedAt: ts };
    this.db
      .prepare(
        `INSERT INTO projects (id, name, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(
        normalized.id,
        normalized.name,
        JSON.stringify(normalized),
        normalized.createdAt,
        ts,
      );
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!row) return null;
    return parseProject(JSON.parse(row.data) as unknown);
  }

  listProjects(): { id: string; name: string; updatedAt: string }[] {
    const rows = this.db
      .prepare("SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC")
      .all() as { id: string; name: string; updated_at: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  // ----- Edit sessions -----

  createSession(projectId: string, description = ""): EditSession | null {
    const project = this.getProject(projectId);
    if (!project) return null;
    const ts = now();
    const session: EditSession = {
      id: createId("session"),
      projectId,
      description,
      status: "open",
      draft: structuredClone(project),
      baseProject: structuredClone(project),
      steps: [],
      createdAt: ts,
      updatedAt: ts,
    };
    this.upsertSession(session);
    return session;
  }

  getSession(id: string): EditSession | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      description: row.description,
      status: row.status,
      draft: parseProject(JSON.parse(row.draft) as unknown),
      baseProject: parseProject(JSON.parse(row.base_project) as unknown),
      steps: JSON.parse(row.steps) as EditSession["steps"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listSessions(projectId: string): EditSession[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as SessionRow[];
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      description: row.description,
      status: row.status,
      draft: parseProject(JSON.parse(row.draft) as unknown),
      baseProject: parseProject(JSON.parse(row.base_project) as unknown),
      steps: JSON.parse(row.steps) as EditSession["steps"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Appends an operation batch to a session's draft and step log. */
  addSessionStep(sessionId: string, operations: Operation[], newDraft: Project): EditSession | null {
    const session = this.getSession(sessionId);
    if (!session || session.status !== "open") return null;
    const updated: EditSession = {
      ...session,
      draft: newDraft,
      steps: [...session.steps, { at: now(), operations }],
      updatedAt: now(),
    };
    this.upsertSession(updated);
    return updated;
  }

  /** Commits a session's draft as the project's current document. */
  approveSession(sessionId: string): { session: EditSession; project: Project } | null {
    const session = this.getSession(sessionId);
    if (!session || session.status !== "open") return null;
    const project = parseProject(structuredClone(session.draft));
    const updated: EditSession = { ...session, status: "approved", updatedAt: now() };

    this.db.exec("BEGIN");
    try {
      this.saveProject(project);
      this.upsertSession(updated);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { session: updated, project };
  }

  discardSession(sessionId: string): EditSession | null {
    const session = this.getSession(sessionId);
    if (!session || session.status !== "open") return null;
    const updated: EditSession = { ...session, status: "discarded", updatedAt: now() };
    this.upsertSession(updated);
    return updated;
  }

  private upsertSession(session: EditSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, description, status, draft, base_project, steps, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           description = excluded.description,
           status = excluded.status,
           draft = excluded.draft,
           base_project = excluded.base_project,
           steps = excluded.steps,
           updated_at = excluded.updated_at`,
      )
      .run(
        session.id,
        session.projectId,
        session.description,
        session.status,
        JSON.stringify(session.draft),
        JSON.stringify(session.baseProject),
        JSON.stringify(session.steps),
        session.createdAt,
        session.updatedAt,
      );
  }

  // ----- References -----

  private rowToReference(row: ReferenceRow): Reference {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      sourceUrl: row.source_url,
      sourcePlatform: row.source_platform,
      kind: row.kind,
      status: row.status,
      error: row.error,
      fileUrl: row.file_url,
      posterUrl: row.poster_url,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      duration: row.duration ?? undefined,
      fps: row.fps ?? undefined,
      transcript: row.transcript ? (JSON.parse(row.transcript) as Reference["transcript"]) : null,
      style: row.style ? (JSON.parse(row.style) as Reference["style"]) : null,
      mediaId: row.media_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createReference(
    projectId: string,
    input: { title: string; sourceUrl?: string | null; sourcePlatform?: string | null; kind?: "video" | "audio" },
  ): Reference {
    const ts = now();
    const reference: Reference = {
      id: createId("ref"),
      projectId,
      title: input.title || "Reference video",
      sourceUrl: input.sourceUrl ?? null,
      sourcePlatform: input.sourcePlatform ?? null,
      kind: input.kind ?? "video",
      status: "importing",
      error: null,
      fileUrl: null,
      posterUrl: null,
      transcript: null,
      style: null,
      mediaId: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db
      .prepare(
        `INSERT INTO "references" (id, project_id, title, source_url, source_platform, kind, status, error, file_url, poster_url, transcript, style, media_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reference.id,
        projectId,
        reference.title,
        reference.sourceUrl,
        reference.sourcePlatform,
        reference.kind,
        reference.status,
        null,
        null,
        null,
        null,
        null,
        null,
        reference.createdAt,
        reference.updatedAt,
      );
    return reference;
  }

  getReference(id: string): Reference | null {
    const row = this.db.prepare('SELECT * FROM "references" WHERE id = ?').get(id) as ReferenceRow | undefined;
    return row ? this.rowToReference(row) : null;
  }

  listReferences(projectId: string): Reference[] {
    const rows = this.db
      .prepare('SELECT * FROM "references" WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as ReferenceRow[];
    return rows.map((r) => this.rowToReference(r));
  }

  updateReference(id: string, patch: Partial<Reference>): Reference | null {
    const existing = this.getReference(id);
    if (!existing) return null;
    const updated: Reference = { ...existing, ...patch, id, updatedAt: now() };
    this.db
      .prepare(
        `UPDATE "references" SET
           title = ?, source_url = ?, source_platform = ?, kind = ?, status = ?, error = ?,
           file_url = ?, poster_url = ?, width = ?, height = ?, duration = ?, fps = ?,
           transcript = ?, style = ?, media_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.title,
        updated.sourceUrl,
        updated.sourcePlatform,
        updated.kind,
        updated.status,
        updated.error,
        updated.fileUrl,
        updated.posterUrl,
        updated.width ?? null,
        updated.height ?? null,
        updated.duration ?? null,
        updated.fps ?? null,
        updated.transcript ? JSON.stringify(updated.transcript) : null,
        updated.style ? JSON.stringify(updated.style) : null,
        updated.mediaId,
        updated.updatedAt,
        id,
      );
    return updated;
  }

  /** Removes a reference row and its media asset from the project document. */
  deleteReference(id: string): Reference | null {
    const existing = this.getReference(id);
    if (!existing) return null;
    this.db.prepare('DELETE FROM "references" WHERE id = ?').run(id);
    if (existing.mediaId) this.removeProjectMedia(existing.projectId, existing.mediaId);
    return existing;
  }

  addProjectMedia(projectId: string, media: Omit<MediaAsset, "id"> & { id?: string }): MediaAsset | null {
    const project = this.getProject(projectId);
    if (!project) return null;
    const asset = createMedia(media);
    this.saveProject(addMedia(project, asset));
    return asset;
  }

  removeProjectMedia(projectId: string, mediaId: string): void {
    const project = this.getProject(projectId);
    if (!project) return;
    this.saveProject(removeMedia(project, mediaId));
  }
}
