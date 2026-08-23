export type PaletteEntry = { hex: string; weight: number };
export type ReferenceTranscript = {
  language: string;
  languageProbability?: number;
  duration?: number;
  segments: { start: number; end: number; text: string }[];
};
export type ReferenceStyleCard = {
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  cuts: number;
  avgShotLength: number;
  pace: "slow" | "steady" | "fast";
  palette: PaletteEntry[];
  avgLuminance: number;
  motion: number;
};
export type Reference = {
  id: string;
  projectId: string;
  title: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  kind: string;
  status: "importing" | "downloading" | "analyzing" | "transcribing" | "ready" | "failed";
  error: string | null;
  fileUrl: string | null;
  posterUrl: string | null;
  transcript: ReferenceTranscript | null;
  style: ReferenceStyleCard | null;
  mediaId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore non-JSON bodies */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const body = await request<{ projects: ProjectSummary[] }>("/api/projects");
  return body.projects;
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const body = await request<{ project: ProjectSummary }>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return body.project;
}

export async function listReferences(projectId: string): Promise<Reference[]> {
  const body = await request<{ references: Reference[] }>(`/api/projects/${projectId}/references`);
  return body.references;
}

export async function importReference(projectId: string, url: string, title?: string): Promise<Reference> {
  const body = await request<{ reference: Reference }>(`/api/projects/${projectId}/references/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, ...(title ? { title } : {}) }),
  });
  return body.reference;
}

export async function uploadReference(projectId: string, file: File, title?: string): Promise<Reference> {
  const params = new URLSearchParams({ filename: file.name });
  if (title) params.set("title", title);
  const body = await request<{ reference: Reference }>(
    `/api/projects/${projectId}/references/upload?${params.toString()}`,
    { method: "POST", body: file },
  );
  return body.reference;
}

export async function deleteReference(referenceId: string): Promise<void> {
  await request(`/api/references/${referenceId}`, { method: "DELETE" });
}

// ----- Edit sessions / AI chat -----

export type SessionStep = { at: string; operations: { op: string; args: unknown }[] };
export type EditSession = {
  id: string;
  projectId: string;
  description: string;
  status: "open" | "approved" | "discarded";
  draft: unknown;
  baseProject: unknown;
  steps: SessionStep[];
  createdAt: string;
  updatedAt: string;
};
export type ToolCallLog = { name: string; status: "ok" | "error" };
export type ChatResponse = { reply: string; sessionId: string; calls: ToolCallLog[] };

export async function createSession(projectId: string): Promise<EditSession> {
  const body = await request<{ session: EditSession }>(`/api/projects/${projectId}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return body.session;
}

export async function getSession(sessionId: string): Promise<EditSession> {
  const body = await request<{ session: EditSession }>(`/api/sessions/${sessionId}`);
  return body.session;
}

export async function sendChat(sessionId: string, prompt: string, provider?: string): Promise<ChatResponse> {
  return request<ChatResponse>(`/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(provider ? { prompt, provider } : { prompt }),
  });
}

export async function approveSession(sessionId: string): Promise<void> {
  await request(`/api/sessions/${sessionId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}

export async function discardSession(sessionId: string): Promise<void> {
  await request(`/api/sessions/${sessionId}/discard`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}