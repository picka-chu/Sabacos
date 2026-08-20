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
  setProject: (project: Project) => void;
  /** Applies a pure Project -> Project mutation from @motion/core operations. */
  apply: (update: (project: Project) => Project) => void;
  setComposition: (compId: string) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  selectLayer: (layerId: string | null) => void;
  setTimelineZoom: (zoom: number) => void;
};

const initialProject = createDemoProject();

export const useEditorStore = create<EditorState>()((set) => ({
  project: initialProject,
  compId: initialProject.compositions[0]?.id ?? "",
  time: 0,
  playing: false,
  selectedLayerId: null,
  timelineZoom: 40,

  setProject: (project) => set({ project }),
  apply: (update) => set((s) => ({ project: update(s.project) })),
  setComposition: (compId) => set({ compId, time: 0, selectedLayerId: null }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  selectLayer: (layerId) => set({ selectedLayerId: layerId }),
  setTimelineZoom: (zoom) => set({ timelineZoom: Math.max(2, zoom) }),
}));
