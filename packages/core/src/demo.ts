import { createComposition, createProject, createShapeLayer, createTextLayer, rgba } from "./factories";
import { addComposition, addLayer, setTransformKeyframe } from "./operations";
import type { Project } from "./types";

export function createDemoProject(): Project {
  let project = createProject({ name: "Motion Studio Demo" });

  const comp = createComposition({
    name: "Main",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 10,
    backgroundColor: rgba(8, 13, 31),
  });
  project = addComposition(project, comp);

  const background = createShapeLayer({
    name: "Background",
    shape: "rect",
    width: 1920,
    height: 1080,
    fill: rgba(20, 23, 51),
    transform: { position: { type: "static", value: { x: 960, y: 540 } } },
  });
  project = addLayer(project, comp.id, background);

  const title = createTextLayer({
    name: "Title",
    text: "Motion Studio",
    fontSize: 130,
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 800,
    fill: rgba(255, 255, 255),
    transform: {
      position: { type: "static", value: { x: 960, y: 420 } },
    },
  });
  project = addLayer(project, comp.id, title);
  project = setTransformKeyframe(project, comp.id, title.id, "scale", 0, { x: 0.4, y: 0.4 }, "linear");
  project = setTransformKeyframe(project, comp.id, title.id, "scale", 0.9, { x: 1, y: 1 }, "easeOutBack");
  project = setTransformKeyframe(project, comp.id, title.id, "opacity", 0, 0, "linear");
  project = setTransformKeyframe(project, comp.id, title.id, "opacity", 0.9, 1, "easeOut");

  const subtitle = createTextLayer({
    name: "Subtitle",
    text: "Create motion graphics with AI",
    fontSize: 46,
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 500,
    fill: rgba(191, 199, 230),
    transform: { position: { type: "static", value: { x: 960, y: 560 } } },
  });
  project = addLayer(project, comp.id, subtitle);
  project = setTransformKeyframe(project, comp.id, subtitle.id, "opacity", 1.1, 0, "linear");
  project = setTransformKeyframe(project, comp.id, subtitle.id, "opacity", 2, 1, "easeOut");

  const circle = createShapeLayer({
    name: "Bouncing ball",
    shape: "ellipse",
    width: 170,
    height: 170,
    fill: rgba(255, 115, 51),
    transform: {
      position: { type: "static", value: { x: 960, y: 300 } },
      opacity: { type: "static", value: 0.9 },
    },
  });
  project = addLayer(project, comp.id, circle);
  project = setTransformKeyframe(project, comp.id, circle.id, "position", 0, { x: 960, y: 300 }, "linear");
  project = setTransformKeyframe(project, comp.id, circle.id, "position", 1.2, { x: 960, y: 830 }, "easeIn");
  project = setTransformKeyframe(project, comp.id, circle.id, "position", 1.9, { x: 960, y: 480 }, "easeOutBack");
  project = setTransformKeyframe(project, comp.id, circle.id, "position", 3.4, { x: 1400, y: 300 }, "easeInOut");
  project = setTransformKeyframe(project, comp.id, circle.id, "rotation", 0, 0, "linear");
  project = setTransformKeyframe(project, comp.id, circle.id, "rotation", 3.4, 720, "easeInOut");

  const outro = createComposition({
    name: "Outro",
    width: 1080,
    height: 1080,
    fps: 30,
    duration: 5,
    backgroundColor: rgba(5, 5, 13),
  });
  project = addComposition(project, outro);

  const thanks = createTextLayer({
    name: "Thanks",
    text: "Thanks for watching",
    fontSize: 76,
    fontWeight: 700,
    transform: { position: { type: "static", value: { x: 540, y: 540 } } },
  });
  project = addLayer(project, outro.id, thanks);
  project = setTransformKeyframe(project, outro.id, thanks.id, "scale", 0, { x: 0, y: 0 }, "linear");
  project = setTransformKeyframe(project, outro.id, thanks.id, "scale", 0.8, { x: 1, y: 1 }, "easeOutBack");

  return project;
}
