import { useEffect, useRef } from "react";
import { CompositionRenderer, createMediaResolver } from "../renderer";
import { useEditorStore } from "../store/useEditorStore";

export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CompositionRenderer | null>(null);

  const project = useEditorStore((s) => s.project);
  const compId = useEditorStore((s) => s.compId);
  const media = project.media;
  const comp = project.compositions.find((c) => c.id === compId);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new CompositionRenderer(createMediaResolver(media));
    rendererRef.current = renderer;
    void renderer.mount(host);
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [media]);

  useEffect(() => {
    if (comp && rendererRef.current) rendererRef.current.setComposition(comp);
  }, [comp]);

  useEffect(() => {
    rendererRef.current?.setSelection(useEditorStore.getState().selectedLayerId);
  }, [useEditorStore((s) => s.selectedLayerId)]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const st = useEditorStore.getState();
      const now = performance.now();
      if (st.playing) {
        const c = st.project.compositions.find((x) => x.id === st.compId);
        if (c) {
          let t = st.time + (now - last) / 1000;
          if (t >= c.duration) t = 0;
          if (t !== st.time) st.setTime(t);
        }
      }
      last = now;
      rendererRef.current?.renderAt(useEditorStore.getState().time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    const host = hostRef.current;
    if (!host || e.button !== 0) return;
    const rect = host.getBoundingClientRect();
    const id = rendererRef.current?.pickAt(e.clientX - rect.left, e.clientY - rect.top) ?? null;
    useEditorStore.getState().selectLayer(id);
  };

  const handleDoubleClick = () => {
    useEditorStore.getState().togglePlaying();
  };

  return (
    <div className="viewport-wrap" ref={hostRef} onPointerDown={handlePointerDown} onDoubleClick={handleDoubleClick}>
      <div className="viewport-hint">
        click to select &middot; double-click to play/pause
      </div>
    </div>
  );
}
