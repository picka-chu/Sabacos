import { create } from "zustand";
import { createDemoProject } from "@motion/core";
import type { Project } from "@motion/core";

type EditorState = {
  project: Project;
  compId: string;
  time: number;
  playing: boolean;
  selectedLayerId: string | null;
  timelineZoom: number;
  showReferences: boolean;
  showAi: boolean;
  /** Server project selected in the References/AI panels (null = none yet). */
  projectId: string | null;
  setProject: (project: Project) => void;
  /** Applies a pure Project -> Project mutation from @motion/core operations. */
  apply: (update: (project: Project) => Project) => void;
  setComposition: (compId: string) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  selectLayer: (layerId: string | null) => void;
  setTimelineZoom: (zoom: number) => void;
  toggleReferences: () => void;
  toggleAi: () => void;
  setProjectId: (projectId: string | null) => void;
  /** Replaces the canvas document with a server-side one and resets the view. */
  loadServerProject: (project: Project) => void;
};

const initialProject = createDemoProject();

export const useEditorStore = create<EditorState>()((set) => ({
  project: initialProject,
  compId: initialProject.compositions[0]?.id ?? "",
  time: 0,
  playing: false,
  selectedLayerId: null,
  timelineZoom: 40,
  showReferences: false,
  showAi: false,
  projectId: null,

  setProject: (project) => set({ project }),
  apply: (update) => set((s) => ({ project: update(s.project) })),
  setComposition: (compId) => set({ compId, time: 0, selectedLayerId: null }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  selectLayer: (layerId) => set({ selectedLayerId: layerId }),
  setTimelineZoom: (zoom) => set({ timelineZoom: Math.max(2, zoom) }),
  toggleReferences: () => set((s) => ({ showReferences: !s.showReferences })),
  toggleAi: () => set((s) => ({ showAi: !s.showAi })),
  setProjectId: (projectId) => set({ projectId }),
  loadServerProject: (project) =>
    set({
      project,
      compId: project.compositions[0]?.id ?? "",
      time: 0,
      selectedLayerId: null,
    }),
}));
