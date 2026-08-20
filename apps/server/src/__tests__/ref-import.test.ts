import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { Store } from "../store";
import { RefImportService, type CommandRunner } from "../ref-import";

function makeFakeRunner(): CommandRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner: CommandRunner = async (cmd) => {
    calls.push([...cmd]);
    const tool = (basename(cmd[0] ?? "") === "python" ? basename(cmd[1] ?? "") : basename(cmd[0] ?? "")).replace(/\.exe$/, "");
    if (tool === "ffprobe") {
      return {
        stdout: JSON.stringify({
          format: { duration: "3.0" },
          streams: [{ codec_type: "video", width: 640, height: 360, avg_frame_rate: "30/1" }],
        }),
        stderr: "",
        code: 0,
      };
    }
    if (tool === "ffmpeg") return { stdout: "", stderr: "", code: 0 };
    if (tool === "analyze.py") {
      return {
        stdout: JSON.stringify({
          width: 640,
          height: 360,
          fps: 30,
          duration: 3.0,
          cuts: 4,
          avgShotLength: 0.75,
          pace: "fast",
          palette: [
            { hex: "#ff0000", weight: 0.4 },
            { hex: "#00ff00", weight: 0.003 },
          ],
          avgLuminance: 0.5,
          motion: "high",
        }),
        stderr: "",
        code: 0,
      };
    }
    if (tool === "transcribe.py") {
      const outFile = cmd[3];
      if (outFile) {
        writeFileSync(
          outFile,
          JSON.stringify({
            language: "en",
            segments: [
              { start: 0, end: 1, text: "hello world" },
              { start: 1, end: 2, text: "this is a reference" },
            ],
          }),
        );
      }
      return { stdout: "", stderr: "", code: 0 };
    }
    throw new Error(`Unexpected command: ${cmd.join(" ")}`);
  };
  return Object.assign(runner, { calls });
}

describe("RefImportService", () => {
  it("imports a local video into the library and registers it as project media", async () => {
    const store = new Store(":memory:");
    const project = store.createProject("Ref test");
    const dataDir = mkdtempSync(join(tmpdir(), "motion-refs-"));
    const sourceFile = join(dataDir, "source.mp4");
    writeFileSync(sourceFile, "not really a video");

    const fake = makeFakeRunner();
    const svc = new RefImportService({ store, dataDir, runner: fake });

    const ref = await svc.importLocalAndWait(project.id, sourceFile, { title: "My reference" });

    expect(ref.status).toBe("ready");
    expect(ref.error).toBeNull();
    expect(ref.title).toBe("My reference");
    expect(ref.sourcePlatform).toBe("local");
    expect(ref.fileUrl).toMatch(/^\/media\/references\//);
    expect(ref.posterUrl).toMatch(/\.jpg$/);
    expect(ref.width).toBe(640);
    expect(ref.duration).toBe(3.0);
    expect(ref.style?.pace).toBe("fast");
    expect(ref.style?.cuts).toBe(4);
    expect(ref.style?.palette.length).toBe(1);
    expect(ref.transcript?.language).toBe("en");
    expect(ref.transcript?.segments.map((s) => s.text)).toEqual(["hello world", "this is a reference"]);
    expect(ref.mediaId).toBeTruthy();

    const updated = store.getProject(project.id)!;
    expect(updated.media.some((m) => m.id === ref.mediaId && m.url === ref.fileUrl)).toBe(true);

    expect(store.getReference(ref.id)?.id).toBe(ref.id);
    expect(store.listReferences(project.id)).toHaveLength(1);
  });

  it("marks an import as failed when a command errors", async () => {
    const store = new Store(":memory:");
    const project = store.createProject("Ref fail");
    const dataDir = mkdtempSync(join(tmpdir(), "motion-refs-"));
    const sourceFile = join(dataDir, "source.mp4");
    writeFileSync(sourceFile, "not really a video");

    const runner: CommandRunner = async () => ({ stdout: "", stderr: "boom", code: 1 });
    const svc = new RefImportService({ store, dataDir, runner });

    const ref = await svc.importLocalAndWait(project.id, sourceFile);

    expect(ref.status).toBe("failed");
    expect(ref.error).toMatch(/boom/);
  });

  it("importFromUrl creates a reference row and runs the pipeline in the background", async () => {
    const store = new Store(":memory:");
    const project = store.createProject("Ref url");
    const dataDir = mkdtempSync(join(tmpdir(), "motion-refs-"));

    const fake = makeFakeRunner();
    const svc = new RefImportService({ store, dataDir, runner: fake });
    svc.importFromUrl(project.id, "https://www.youtube.com/watch?v=abc", "YT ref");

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));

    const refs = store.listReferences(project.id);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.sourcePlatform).toBe("youtube");
    expect(fake.calls.some((c) => c.includes("-m") && c.includes("yt_dlp"))).toBe(true);
  });
});
