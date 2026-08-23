import { addLayer, createShapeLayer, createTextLayer, rgba, staticValue } from "@motion/core";
import type { Composition, Layer, Project } from "@motion/core";
import { useEditorStore } from "../store/useEditorStore";

type ElementKind = "text" | "rect" | "ellipse" | "triangle" | "line";

const ITEMS: { kind: ElementKind; label: string; icon: string }[] = [
  { kind: "text", label: "Add text layer", icon: "T" },
  { kind: "rect", label: "Add rectangle", icon: "\u25AD" },
  { kind: "ellipse", label: "Add ellipse", icon: "\u25EF" },
  { kind: "triangle", label: "Add triangle", icon: "\u25B3" },
  { kind: "line", label: "Add line", icon: "\u2571" },
];

function createElement(kind: ElementKind, comp: Composition): Layer {
  const center = { x: comp.width / 2, y: comp.height / 2 };
  const transform = { position: staticValue(center) };
  const base = { outPoint: comp.duration, transform };
  if (kind === "text") {
    return createTextLayer({ ...base, name: "Text", text: "Your text", fontSize: Math.round(comp.height / 12) });
  }
  const sizes: Record<Exclude<ElementKind, "text">, { w: number; h: number }> = {
    rect: { w: Math.round(comp.width * 0.3), h: Math.round(comp.height * 0.3) },
    ellipse: { w: Math.round(comp.height * 0.3), h: Math.round(comp.height * 0.3) },
    triangle: { w: Math.round(comp.height * 0.35), h: Math.round(comp.height * 0.35) },
    line: { w: Math.round(comp.width * 0.4), h: 4 },
  };
  const { w, h } = sizes[kind];
  return createShapeLayer({
    ...base,
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    shape: kind,
    width: w,
    height: h,
    fill: kind === "line" ? null : rgba(53, 196, 255),
    stroke: kind === "line" ? { color: rgba(255, 255, 255), width: 4 } : undefined,
  });
}

export function AddElementBar() {
  const compId = useEditorStore((s) => s.compId);
  const apply = useEditorStore((s) => s.apply);
  const selectLayer = useEditorStore((s) => s.selectLayer);

  const add = (kind: ElementKind) => {
    const { project } = useEditorStore.getState();
    const comp = project.compositions.find((c) => c.id === compId);
    if (!comp) return;
    const layer = createElement(kind, comp);
    apply((p) => addLayer(p, compId, layer));
    selectLayer(layer.id);
  };

  return (
    <div className="add-element-bar" data-testid="add-element-bar">
      {ITEMS.map((item) => (
        <button
          key={item.kind}
          className="add-element-btn"
          title={item.label}
          onClick={() => add(item.kind)}
          data-testid={`add-${item.kind}`}
        >
          <span className="add-element-icon">{item.icon}</span>
          <span className="add-element-label">{item.kind === "text" ? "Text" : item.kind.charAt(0).toUpperCase() + item.kind.slice(1)}</span>
        </button>
      ))}
    </div>
  );
}