import type { Layer } from "@motion/core";
import {
  moveLayerToIndex,
  removeLayer,
  duplicateLayer,
  setLayerLocked,
  setLayerVisible,
} from "@motion/core";
import { useEditorStore } from "../store/useEditorStore";
import { AddElementBar } from "./AddElementBar";

const KIND_ICONS: Record<Layer["kind"], string> = {
  image: "\u{1F5BC}",
  video: "\u{1F3A5}",
  text: "T",
  shape: "\u25A1",
  audio: "\u266A",
};

export function LayerList() {
  const project = useEditorStore((s) => s.project);
  const compId = useEditorStore((s) => s.compId);
  const selected = useEditorStore((s) => s.selectedLayerId);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const apply = useEditorStore((s) => s.apply);

  const comp = project.compositions.find((c) => c.id === compId);
  if (!comp) return null;

  const layersTopDown = [...comp.layers].reverse();

  return (
    <aside className="side-panel layer-list">
      <h2 className="panel-title">Layers</h2>
      <AddElementBar />
      <div className="layer-rows">
        {layersTopDown.map((layer) => (
          <div
            key={layer.id}
            className={`layer-row ${layer.id === selected ? "is-selected" : ""}`}
            onClick={() => selectLayer(layer.id)}
          >
            <button
              className={`mini-btn ${layer.visible ? "is-on" : ""}`}
              title="Toggle visibility"
              onClick={(e) => {
                e.stopPropagation();
                apply((p) => setLayerVisible(p, compId, layer.id, !layer.visible));
              }}
            >
              {layer.visible ? "\u25C9" : "\u25CB"}
            </button>
            <button
              className={`mini-btn ${layer.locked ? "is-on" : ""}`}
              title="Toggle lock"
              onClick={(e) => {
                e.stopPropagation();
                apply((p) => setLayerLocked(p, compId, layer.id, !layer.locked));
              }}
            >
              {layer.locked ? "\u{1F512}" : "\u{1F513}"}
            </button>
            <span className="kind-icon" style={{ opacity: layer.visible ? 1 : 0.35 }}>
              {KIND_ICONS[layer.kind]}
            </span>
            <span className="layer-name" title={layer.name}>
              {layer.name}
            </span>
            <button
              className="mini-btn mini-danger"
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation();
                apply((p) => duplicateLayer(p, compId, layer.id));
              }}
            >
              &#9442;
            </button>
            <button
              className="mini-btn mini-danger"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                apply((p) => removeLayer(p, compId, layer.id));
                if (selected === layer.id) selectLayer(null);
              }}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
      <div className="panel-footer">
        <button
          className="toolbar-btn"
          disabled={!selected}
          onClick={() => selected && apply((p) => moveLayerToIndex(p, compId, selected, comp.layers.length - 1))}
          title="Bring selected to front"
        >
          &#9650;
        </button>
        <button
          className="toolbar-btn"
          disabled={!selected}
          onClick={() => selected && apply((p) => moveLayerToIndex(p, compId, selected, 0))}
          title="Send selected to back"
        >
          &#9660;
        </button>
      </div>
    </aside>
  );
}
