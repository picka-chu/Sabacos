import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Layer } from "@motion/core";
import { useEditorStore } from "../store/useEditorStore";

const TRANSFORM_PROPS = ["position", "scale", "rotation", "opacity"] as const;

const KIND_COLORS: Record<Layer["kind"], string> = {
  image: "#7c5cff",
  video: "#3f9eff",
  text: "#ffb347",
  shape: "#35c4ff",
  audio: "#63d47a",
};

function niceStep(minStep: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(minStep)));
  for (const m of [1, 2, 5, 10]) {
    if (m * p >= minStep) return m * p;
  }
  return 10 * p;
}

export function Timeline() {
  const project = useEditorStore((s) => s.project);
  const compId = useEditorStore((s) => s.compId);
  const time = useEditorStore((s) => s.time);
  const selected = useEditorStore((s) => s.selectedLayerId);
  const zoom = useEditorStore((s) => s.timelineZoom);
  const setTime = useEditorStore((s) => s.setTime);
  const selectLayer = useEditorStore((s) => s.selectLayer);

  const contentRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const comp = project.compositions.find((c) => c.id === compId);
  if (!comp) return null;

  const toTime = (clientX: number): number => {
    const el = contentRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(Math.max((clientX - rect.left) / zoom, 0), comp.duration);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    setTime(toTime(e.clientX));
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (draggingRef.current) setTime(toTime(e.clientX));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const layersTopDown = [...comp.layers].reverse();
  const markStep = niceStep(100 / zoom);
  const marks: number[] = [];
  for (let t = 0; t <= comp.duration + 1e-9; t += markStep) marks.push(t);

  return (
    <div className="timeline">
      <div
        ref={contentRef}
        className="timeline-content"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="ruler">
          {marks.map((t) => (
            <span key={t} className="ruler-mark" style={{ left: t * zoom }}>
              <i />
              <em>{t.toFixed(1)}s</em>
            </span>
          ))}
        </div>
        <div className="tracks">
          {layersTopDown.length === 0 && <div className="empty-tracks">No layers yet</div>}
          {layersTopDown.map((layer) => (
            <div key={layer.id}>
              <div
                className={`track-row ${layer.id === selected ? "is-selected" : ""}`}
                onClick={() => selectLayer(layer.id)}
              >
                <div className="track-label" title={layer.name}>
                  <span className="kind-dot" style={{ background: KIND_COLORS[layer.kind] }} />
                  {layer.name}
                  {layer.locked && <span className="lock-badge">&#128274;</span>}
                </div>
                <div className="track-lane">
                  <div
                    className="clip"
                    style={{
                      left: layer.inPoint * zoom,
                      width: Math.max(1, (layer.outPoint - layer.inPoint) * zoom),
                      background: KIND_COLORS[layer.kind],
                    }}
                    title={`${layer.kind} · ${layer.inPoint.toFixed(2)}s → ${layer.outPoint.toFixed(2)}s`}
                  >
                    {layer.name}
                  </div>
                </div>
              </div>
              {layer.id === selected && (
                <div className="track-props">
                  {TRANSFORM_PROPS.map((prop) => {
                    const anim = layer.transform[prop];
                    if (anim.type !== "animated") return null;
                    return (
                      <div key={prop} className="track-prop">
                        <span className="prop-name">{prop}</span>
                        <div className="prop-lane">
                          {anim.keyframes.map((k) => (
                            <span
                              key={k.time}
                              className="kf"
                              style={{ left: k.time * zoom - 4 }}
                              title={`${prop} @ ${k.time.toFixed(2)}s`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="playhead" style={{ left: time * zoom }} />
      </div>
    </div>
  );
}
