import { useEffect, useState } from "react";
import {
  createId,
  evaluateAnimatable,
  renameLayer,
  setEffectEnabled,
  setLayerRange,
  setShapeStyle,
  setTextContent,
  setTextStyle,
  setTransformKeyframe,
  setTransformStatic,
  setVideoStyle,
  setAudioStyle,
  updateEffect,
  addEffect,
  removeEffect,
  type Effect,
  type Layer,
  type Project,
  type Rgba,
  type TransformPropKey,
  type TransformValues,
  type Animatable,
  type Vec2,
} from "@motion/core";
import { useEditorStore } from "../store/useEditorStore";
import { hexToRgba, rgbaToHexCss } from "../lib/color";

const round = (n: number) => Math.round(n * 100) / 100;

function commitTransformValue<K extends TransformPropKey>(
  project: Project,
  apply: (update: (p: Project) => Project) => void,
  compId: string,
  layerId: string,
  time: number,
  prop: K,
  value: TransformValues[K],
): void {
  const comp = project.compositions.find((c) => c.id === compId);
  const layer = comp?.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (layer.transform[prop].type === "animated") {
    apply((p) => setTransformKeyframe(p, compId, layerId, prop, time, value, "linear"));
  } else {
    apply((p) => setTransformStatic(p, compId, layerId, prop, value));
  }
}

function NumField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) {
      onCommit(min !== undefined && max !== undefined ? Math.min(max, Math.max(min, n)) : n);
    } else {
      setText(String(round(value)));
    }
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onCommit,
  multiline = false,
  testId,
}: {
  label: string;
  value: string;
  onCommit: (s: string) => void;
  multiline?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (v: string) => onCommit(v);
  return (
    <label className="field field-grow">
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          data-testid={testId}
        />
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          data-testid={testId}
        />
      )}
    </label>
  );
}

function ColorField({
  label,
  rgba,
  onCommit,
}: {
  label: string;
  rgba: Rgba;
  onCommit: (c: Rgba) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="color"
        value={rgbaToHexCss(rgba)}
        onChange={(e) => onCommit(hexToRgba(e.target.value, rgba.a))}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  options: string[];
  onCommit: (s: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onCommit(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function EffectDefaults(type: Effect["type"]): Effect {
  const id = createId("effect");
  const s = (v: number) => ({ type: "static", value: v } as const);
  switch (type) {
    case "blur":
      return { id, type, enabled: true, amount: s(8) };
    case "colorAdjust":
      return {
        id,
        type,
        enabled: true,
        brightness: s(0),
        contrast: s(0),
        saturation: s(0),
        hue: s(0),
      };
    case "chromaKey":
      return { id, type, enabled: true, color: { r: 0, g: 1, b: 0, a: 1 }, similarity: 0.4, smoothness: 0.1 };
    case "invert":
      return { id, type, enabled: true };
    case "sepia":
      return { id, type, enabled: true, amount: s(1) };
    case "noise":
      return { id, type, enabled: true, amount: s(0.2) };
  }
}

const EFFECT_TYPES: Effect["type"][] = ["blur", "colorAdjust", "chromaKey", "invert", "sepia", "noise"];

function EffectEditor({ layer }: { layer: Layer }) {
  const project = useEditorStore((s) => s.project);
  const compId = useEditorStore((s) => s.compId);
  const apply = useEditorStore((s) => s.apply);
  const [addOpen, setAddOpen] = useState(false);

  const patch = (effectId: string, p: Record<string, unknown>) =>
    apply((pr) => updateEffect(pr, compId, layer.id, effectId, p));

  return (
    <section className="inspector-section">
      <h3>Effects</h3>
      {layer.effects.map((effect) => (
        <div key={effect.id} className="effect-row">
          <div className="effect-head">
            <input
              type="checkbox"
              checked={effect.enabled}
              onChange={(e) => apply((p) => setEffectEnabled(p, compId, layer.id, effect.id, e.target.checked))}
              title="Enable"
            />
            <span className="effect-name">{effect.type}</span>
            <button
              className="mini-btn mini-danger"
              title="Remove effect"
              onClick={() => apply((p) => removeEffect(p, compId, layer.id, effect.id))}
            >
              &times;
            </button>
          </div>
          {effect.enabled && (
            <div className="effect-params">
              {effect.type === "blur" && (
                <NumField
                  label="Amount"
                  value={evaluateAnimatable(effect.amount, useEditorStore.getState().time)}
                  onCommit={(n) => patch(effect.id, { amount: { type: "static", value: n } })}
                  min={0}
                  max={60}
                />
              )}
              {effect.type === "colorAdjust" && (
                <>
                  <NumField
                    label="Brightness"
                    value={evaluateAnimatable(effect.brightness, useEditorStore.getState().time)}
                    onCommit={(n) => patch(effect.id, { brightness: { type: "static", value: n } })}
                    step={0.05}
                    min={-1}
                    max={1}
                  />
                  <NumField
                    label="Contrast"
                    value={evaluateAnimatable(effect.contrast, useEditorStore.getState().time)}
                    onCommit={(n) => patch(effect.id, { contrast: { type: "static", value: n } })}
                    step={0.05}
                    min={-1}
                    max={1}
                  />
                  <NumField
                    label="Saturation"
                    value={evaluateAnimatable(effect.saturation, useEditorStore.getState().time)}
                    onCommit={(n) => patch(effect.id, { saturation: { type: "static", value: n } })}
                    step={0.05}
                    min={-1}
                    max={1}
                  />
                  <NumField
                    label="Hue"
                    value={evaluateAnimatable(effect.hue, useEditorStore.getState().time)}
                    onCommit={(n) => patch(effect.id, { hue: { type: "static", value: n } })}
                    step={1}
                    min={-180}
                    max={180}
                  />
                </>
              )}
              {effect.type === "chromaKey" && (
                <>
                  <ColorField
                    label="Key color"
                    rgba={effect.color}
                    onCommit={(c) => patch(effect.id, { color: c })}
                  />
                  <NumField
                    label="Similarity"
                    value={effect.similarity}
                    onCommit={(n) => patch(effect.id, { similarity: n })}
                    step={0.05}
                    min={0}
                    max={1}
                  />
                  <NumField
                    label="Smoothness"
                    value={effect.smoothness}
                    onCommit={(n) => patch(effect.id, { smoothness: n })}
                    step={0.05}
                    min={0}
                    max={1}
                  />
                </>
              )}
              {(effect.type === "sepia" || effect.type === "noise") && (
                <NumField
                  label="Amount"
                  value={evaluateAnimatable(effect.amount, useEditorStore.getState().time)}
                  onCommit={(n) => patch(effect.id, { amount: { type: "static", value: n } })}
                  step={0.05}
                  min={0}
                  max={1}
                />
              )}
            </div>
          )}
        </div>
      ))}
      {addOpen && (
        <div className="add-effect">
          <select
            autoFocus
            onChange={(e) => {
              apply((p) => addEffect(p, compId, layer.id, EffectDefaults(e.target.value as Effect["type"])));
              setAddOpen(false);
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Add effect...
            </option>
            {EFFECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}
      {!addOpen && (
        <button className="toolbar-btn add-effect-btn" onClick={() => setAddOpen(true)}>
          + Add effect
        </button>
      )}
      <p className="footnote">{project.name} · {project.version}</p>
    </section>
  );
}

function TransformEditor({ layer }: { layer: Layer }) {
  const project = useEditorStore((s) => s.project);
  const compId = useEditorStore((s) => s.compId);
  const time = useEditorStore((s) => s.time);
  const apply = useEditorStore((s) => s.apply);

  const edit = <K extends TransformPropKey>(prop: K, value: TransformValues[K]) =>
    commitTransformValue(project, apply, compId, layer.id, time, prop, value);

  const position = evaluateAnimatable(layer.transform.position, time);
  const scale = evaluateAnimatable(layer.transform.scale, time);
  const rotation = evaluateAnimatable(layer.transform.rotation, time);
  const opacity = evaluateAnimatable(layer.transform.opacity, time);

  const key = (prop: TransformPropKey) => {
    const anim = layer.transform[prop];
    if (anim.type !== "animated") return;
    const value = evaluateAnimatable(anim as Animatable<number | Vec2>, time);
    edit(prop, value);
  };

  return (
    <section className="inspector-section">
      <h3>Transform</h3>
      <div className="field-row">
        <NumField
          label="Position X"
          value={position.x}
          onCommit={(n) => edit("position", { ...position, x: n })}
        />
        <NumField
          label="Position Y"
          value={position.y}
          onCommit={(n) => edit("position", { ...position, y: n })}
        />
      </div>
      <div className="field-row">
        <NumField
          label="Scale X"
          value={scale.x}
          step={0.05}
          onCommit={(n) => edit("scale", { ...scale, x: n })}
        />
        <NumField
          label="Scale Y"
          value={scale.y}
          step={0.05}
          onCommit={(n) => edit("scale", { ...scale, y: n })}
        />
      </div>
      <div className="field-row">
        <NumField label="Rotation" value={rotation} onCommit={(n) => edit("rotation", n)} />
        <NumField
          label="Opacity"
          value={opacity}
          step={0.05}
          min={0}
          max={1}
          onCommit={(n) => edit("opacity", n)}
        />
      </div>
      <div className="keyframe-hint">
        {(
          [
            ["position", "P"],
            ["scale", "S"],
            ["rotation", "R"],
            ["opacity", "O"],
          ] as const
        ).map(([prop, short]) => (
          <button
            key={prop}
            className={`toolbar-btn ${layer.transform[prop].type === "animated" ? "has-keyframes" : ""}`}
            title={`${layer.transform[prop].type === "animated" ? "Add" : "Make static"} ${prop}`}
            onClick={() => key(prop)}
          >
            {short}
            {layer.transform[prop].type === "animated" ? "◆" : ""}
          </button>
        ))}
        <span className="footnote">click = keyframe at playhead</span>
      </div>
    </section>
  );
}

export function Inspector() {
  const project = useEditorStore((s) => s.project);
  const compId = useEditorStore((s) => s.compId);
  const time = useEditorStore((s) => s.time);
  const selected = useEditorStore((s) => s.selectedLayerId);
  const apply = useEditorStore((s) => s.apply);

  const comp = project.compositions.find((c) => c.id === compId);
  const layer = comp?.layers.find((l) => l.id === selected);

  if (!comp) {
    return (
      <aside className="side-panel inspector">
        <p className="footnote">No composition.</p>
      </aside>
    );
  }
  if (!layer) {
    return (
      <aside className="side-panel inspector">
        <h2 className="panel-title">Inspector</h2>
        <p className="footnote">Select a layer on the canvas or in the layer list.</p>
      </aside>
    );
  }

  return (
    <aside className="side-panel inspector">
      <h2 className="panel-title">Inspector</h2>
      <div className="inspector-scroll">
        <section className="inspector-section">
          <TextField
            label="Name"
            value={layer.name}
            onCommit={(n) => apply((p) => renameLayer(p, compId, layer.id, n))}
            testId="inspector-name"
          />
          <p className="footnote">kind: {layer.kind} · id: {layer.id.slice(0, 8)}</p>
          <div className="field-row">
            <NumField
              label="In"
              value={layer.inPoint}
              step={0.1}
              min={0}
              max={layer.outPoint}
              onCommit={(n) => apply((p) => setLayerRange(p, compId, layer.id, { inPoint: n }))}
            />
            <NumField
              label="Out"
              value={layer.outPoint}
              step={0.1}
              min={layer.inPoint}
              max={comp.duration}
              onCommit={(n) => apply((p) => setLayerRange(p, compId, layer.id, { outPoint: n }))}
            />
          </div>
        </section>

        <TransformEditor layer={layer} />

        <section className="inspector-section">
          <h3>Layer</h3>
          {layer.kind === "text" && (
            <>
              <TextField label="Content" value={layer.text} multiline onCommit={(t) => apply((p) => setTextContent(p, compId, layer.id, t))} />
              <div className="field-row">
                <NumField
                  label="Font size"
                  value={layer.fontSize}
                  onCommit={(n) => apply((p) => setTextStyle(p, compId, layer.id, { fontSize: n }))}
                  min={1}
                />
                <NumField
                  label="Weight"
                  value={layer.fontWeight}
                  step={100}
                  min={100}
                  max={900}
                  onCommit={(n) => apply((p) => setTextStyle(p, compId, layer.id, { fontWeight: n }))}
                />
              </div>
              <div className="field-row">
                <ColorField
                  label="Fill"
                  rgba={layer.fill}
                  onCommit={(c) => apply((p) => setTextStyle(p, compId, layer.id, { fill: c }))}
                />
                <SelectField
                  label="Align"
                  value={layer.align}
                  options={["left", "center", "right"]}
                  onCommit={(a) => apply((p) => setTextStyle(p, compId, layer.id, { align: a as "left" | "center" | "right" }))}
                />
              </div>
              <div className="field-row">
                <NumField
                  label="Letter spacing"
                  value={layer.letterSpacing}
                  onCommit={(n) => apply((p) => setTextStyle(p, compId, layer.id, { letterSpacing: n }))}
                />
                <NumField
                  label="Max width"
                  value={layer.maxWidth ?? 0}
                  min={0}
                  onCommit={(n) => apply((p) => setTextStyle(p, compId, layer.id, { maxWidth: n > 0 ? n : null }))}
                />
              </div>
            </>
          )}
          {layer.kind === "shape" && (
            <>
              <div className="field-row">
                <SelectField
                  label="Shape"
                  value={layer.shape}
                  options={["rect", "ellipse", "triangle", "line"]}
                  onCommit={(s) =>
                    apply((p) =>
                      setShapeStyle(p, compId, layer.id, {
                        shape: s as Extract<Layer, { kind: "shape" }>["shape"],
                      }),
                    )
                  }
                />
              </div>
              <div className="field-row">
                <NumField
                  label="Width"
                  value={layer.width}
                  min={1}
                  onCommit={(n) => apply((p) => setShapeStyle(p, compId, layer.id, { width: n }))}
                />
                <NumField
                  label="Height"
                  value={layer.height}
                  min={1}
                  onCommit={(n) => apply((p) => setShapeStyle(p, compId, layer.id, { height: n }))}
                />
              </div>
              <div className="field-row">
                <ColorField
                  label="Fill"
                  rgba={layer.fill ?? { r: 1, g: 1, b: 1, a: 1 }}
                  onCommit={(c) => apply((p) => setShapeStyle(p, compId, layer.id, { fill: c }))}
                />
              </div>
            </>
          )}
          {(layer.kind === "image" || layer.kind === "video") && (
            <p className="footnote">
              {layer.width} x {layer.height}px · source {layer.source.type}
            </p>
          )}
          {layer.kind === "video" && (
            <NumField
              label="Volume"
              value={layer.volume}
              step={0.05}
              min={0}
              max={1}
              onCommit={(n) => apply((p) => setVideoStyle(p, compId, layer.id, { volume: n }))}
            />
          )}
          {layer.kind === "audio" && (
            <div className="field-row">
              <NumField
                label="Volume"
                value={layer.volume}
                step={0.05}
                min={0}
                max={1}
                onCommit={(n) => apply((p) => setAudioStyle(p, compId, layer.id, { volume: n }))}
              />
              <NumField
                label="Rate"
                value={layer.playbackRate}
                step={0.1}
                min={0.25}
                max={4}
                onCommit={(n) => apply((p) => setAudioStyle(p, compId, layer.id, { playbackRate: n }))}
              />
            </div>
          )}
        </section>

        <EffectEditor layer={layer} />
      </div>
    </aside>
  );
}
