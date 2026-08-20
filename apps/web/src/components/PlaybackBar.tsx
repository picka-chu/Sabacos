import { useEditorStore } from "../store/useEditorStore";
import { formatTime } from "../lib/time";

export function PlaybackBar() {
  const project = useEditorStore((s) => s.project);
  const compId = useEditorStore((s) => s.compId);
  const time = useEditorStore((s) => s.time);
  const playing = useEditorStore((s) => s.playing);
  const timelineZoom = useEditorStore((s) => s.timelineZoom);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const setTime = useEditorStore((s) => s.setTime);
  const setComposition = useEditorStore((s) => s.setComposition);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);

  const comp = project.compositions.find((c) => c.id === compId);
  if (!comp) return null;
  const fps = comp.fps;

  return (
    <header className="toolbar">
      <button
        className="toolbar-btn"
        onClick={() => setTime(0)}
        title="Go to start"
      >
        |&laquo;
      </button>
      <button
        className="toolbar-btn toolbar-btn-primary"
        onClick={togglePlaying}
        title="Play / Pause"
        data-testid="play-toggle"
      >
        {playing ? "\u23F8" : "\u25B6"}
      </button>
      <div className="timecode">
        <input
          className="timecode-input"
          value={formatTime(time, fps)}
          title="mm:ss:ff"
          data-testid="timecode"
          onChange={(e) => {
            const parts = e.target.value.split(":").map((p) => parseInt(p, 10));
            const [mm, ss, ff] = parts;
            if (mm !== undefined && ss !== undefined && ff !== undefined && [mm, ss, ff].every((p) => Number.isFinite(p))) {
              const t = mm * 60 + ss + ff / fps;
              setTime(Math.min(Math.max(t, 0), comp.duration));
            }
          }}
        />
        <span className="timecode-total">{formatTime(comp.duration, fps)}</span>
      </div>
      <select
        className="comp-select"
        value={compId}
        onChange={(e) => setComposition(e.target.value)}
        title="Composition"
      >
        {project.compositions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} &middot; {c.width}x{c.height} &middot; {c.duration}s
          </option>
        ))}
      </select>
      <div className="toolbar-spacer" />
      <span className="zoom-label">{Math.round(timelineZoom)}px/s</span>
      <button className="toolbar-btn" onClick={() => setTimelineZoom(timelineZoom / 1.5)} title="Zoom out">
        &minus;
      </button>
      <button className="toolbar-btn" onClick={() => setTimelineZoom(timelineZoom * 1.5)} title="Zoom in">
        +
      </button>
    </header>
  );
}
