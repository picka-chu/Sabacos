import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reference, Store } from "./store";

export type CommandRunner = (cmd: string[], opts?: { cwd?: string; timeoutMs?: number }) => Promise<{
  stdout: string;
  stderr: string;
  code: number;
}>;

export type RefImportDeps = {
  store: Store;
  notify?: (ref: Reference) => void;
  runner?: CommandRunner;
  /** Root data dir (default ./data). References live in <dataDir>/references. */
  dataDir?: string;
  /** Dir containing ffmpeg/ffprobe (default <dataDir>/bin). */
  ffmpegDir?: string;
  whisperModel?: string;
  whisperLanguage?: string;
};

function defaultRunner(cmd: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { windowsHide: true }) as unknown as {
      stdout: import("node:stream").Readable;
      stderr: import("node:stream").Readable;
      on(event: string, cb: (...args: never[]) => void): void;
      kill(): void;
    };
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code: number) => resolvePromise({ stdout, stderr, code }));
    if (opts?.timeoutMs) {
      setTimeout(() => child.kill(), opts.timeoutMs);
    }
  });
}

export function detectPlatform(url: string): string | null {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/vimeo\.com/i.test(url)) return "vimeo";
  if (/\.(mp4|webm|mov|mkv|avi|m4v)(\?|$)/i.test(url)) return "direct";
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

/**
 * Orchestrates reference-video import: yt-dlp download (optional), ffprobe
 * probe, thumbnail extraction, PyAV style analysis and faster-whisper
 * transcription, then registers the clip as project media.
 */
export class RefImportService {
  private readonly store: Store;
  private readonly notify?: (ref: Reference) => void;
  private readonly runner: CommandRunner;
  private readonly dataDir: string;
  private readonly ffmpegDir: string;
  private readonly whisperModel: string;
  private readonly whisperLanguage?: string;

  constructor(deps: RefImportDeps) {
    this.store = deps.store;
    this.notify = deps.notify;
    this.runner = deps.runner ?? defaultRunner;
    this.dataDir = deps.dataDir ?? resolve(process.cwd(), "data");
    this.ffmpegDir = deps.ffmpegDir ?? join(this.dataDir, "bin");
    this.whisperModel = deps.whisperModel ?? process.env.WHISPER_MODEL ?? "base";
    this.whisperLanguage = deps.whisperLanguage ?? process.env.WHISPER_LANGUAGE ?? undefined;
  }

  /** Resolves a library filename to its absolute path (safe against traversal). */
  async resolveFile(name: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
    const path = join(this.refsDir(), name);
    if (!path.startsWith(this.refsDir()) || !existsSync(path)) return null;
    return path;
  }

  async removeFiles(refId: string): Promise<void> {
    const dir = this.refsDir();
    if (!existsSync(dir)) return;
    const { unlink } = await import("node:fs/promises");
    for (const f of readdirSync(dir)) {
      if (f.startsWith(refId)) {
        await unlink(join(dir, f)).catch(() => undefined);
      }
    }
  }

  private refsDir(): string {
    return join(this.dataDir, "references");
  }

  private script(name: string): string {
    return fileURLToPath(new URL(`./scripts/${name}`, import.meta.url));
  }

  private async run(cmd: string[], timeoutMs?: number): Promise<string> {
    const res = await this.runner(cmd, { timeoutMs });
    if (res.code !== 0) {
      throw new Error(`${cmd[0]} failed (${res.code}): ${res.stderr.trim().slice(0, 500) || res.stdout.trim().slice(0, 500)}`);
    }
    return res.stdout.trim();
  }

  /** Creates a reference row and starts the import pipeline in the background. */
  importFromUrl(projectId: string, url: string, title?: string): Reference {
    const ref = this.store.createReference(projectId, {
      title: title ?? guessTitleFromUrl(url),
      sourceUrl: url,
      sourcePlatform: detectPlatform(url),
    });
    void this.runPipeline(ref.id);
    return ref;
  }

  /** Writes an uploaded file into the library and starts the pipeline. */
  importUpload(projectId: string, filename: string, bytes: Uint8Array, opts?: { title?: string }): Reference {
    const ref = this.store.createReference(projectId, {
      title: opts?.title ?? (basename(filename).replace(/\.[^.]+$/, "") || "Reference video"),
      sourcePlatform: "local",
    });
    const ext = extname(filename).replace(/^\./, "") || "mp4";
    const dest = join(this.refsDir(), `${ref.id}.${ext}`);
    mkdirSync(dirname(dest), { recursive: true });
    void import("node:fs/promises").then(({ writeFile }) =>
      writeFile(dest, bytes).then(
        () => this.runPipeline(ref.id, { alreadyDownloaded: true }),
        (error: Error) => this.store.updateReference(ref.id, { status: "failed", error: error.message }),
      ),
    );
    return ref;
  }

  async importAndWait(projectId: string, url: string, title?: string): Promise<Reference> {
    const ref = this.store.createReference(projectId, {
      title: title ?? guessTitleFromUrl(url),
      sourceUrl: url,
      sourcePlatform: detectPlatform(url),
    });
    await this.runPipeline(ref.id);
    return this.store.getReference(ref.id)!;
  }

  async importLocalAndWait(
    projectId: string,
    filePath: string,
    opts?: { title?: string; platform?: string },
  ): Promise<Reference> {
    const ref = this.store.createReference(projectId, {
      title: (opts?.title ?? basename(filePath).replace(/\.[^.]+$/, "")) || "Reference video",
      sourcePlatform: opts?.platform ?? "local",
    });
    const ext = extname(filePath).replace(/^\./, "") || "mp4";
    const dest = join(this.refsDir(), `${ref.id}.${ext}`);
    mkdirSync(dirname(dest), { recursive: true });
    await this.copyFile(filePath, dest);
    await this.runPipeline(ref.id, { alreadyDownloaded: true });
    return this.store.getReference(ref.id)!;
  }

  private async copyFile(src: string, dest: string): Promise<void> {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(src, dest);
  }

  private async runPipeline(refId: string, opts?: { alreadyDownloaded?: boolean }): Promise<void> {
    const update = (patch: Partial<Reference>) => {
      const updated = this.store.updateReference(refId, patch);
      if (updated) this.notify?.(updated);
    };
    update({ status: "importing", error: null });

    let filePath: string | undefined;
    try {
      mkdirSync(this.refsDir(), { recursive: true });

      if (!opts?.alreadyDownloaded) {
        const ref = this.store.getReference(refId)!;
        await this.download(ref.sourceUrl!, ref.id);
      }
      filePath = this.findDownloadedFile(refId);
      if (!filePath) throw new Error("Download produced no file");

      const probe = await this.probe(filePath);
      const ext = extname(filePath).replace(/^\./, "") || "mp4";
      const posterPath = join(this.refsDir(), `${refId}.jpg`);
      await this.thumbnail(filePath, posterPath, probe.duration);

      const style = await this.analyze(filePath);
      const transcript = await this.transcribe(filePath);

      const projectId = this.store.getReference(refId)!.projectId;
      const media = this.store.addProjectMedia(projectId, {
        kind: "video",
        name: this.store.getReference(refId)!.title,
        mimeType: MIME_BY_EXT[ext] ?? "video/mp4",
        url: `/media/references/${refId}.${ext}`,
        width: probe.width,
        height: probe.height,
        duration: probe.duration,
      });

      update({
        status: "ready",
        error: null,
        fileUrl: `/media/references/${refId}.${ext}`,
        posterUrl: `/media/references/${refId}.jpg`,
        width: style.width ?? probe.width,
        height: style.height ?? probe.height,
        duration: style.duration ?? probe.duration,
        fps: style.fps ?? probe.fps,
        style,
        transcript,
        mediaId: media?.id ?? null,
      });
    } catch (error) {
      update({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        fileUrl: filePath ? this.fileUrlFor(refId) : null,
      });
    }
  }

  private fileUrlFor(refId: string): string | null {
    const file = this.findDownloadedFile(refId);
    if (!file) return null;
    const ext = extname(file).replace(/^\./, "") || "mp4";
    return `/media/references/${refId}.${ext}`;
  }

  private async download(url: string, refId: string): Promise<void> {
    const outTemplate = join(this.refsDir(), `${refId}.%(ext)s`);
    await this.run(
      [
        "python",
        "-m",
        "yt_dlp",
        "-f",
        "best[height<=1080]/best",
        "--no-playlist",
        "--no-warnings",
        "-o",
        outTemplate,
        url,
      ],
      10 * 60_000,
    );
  }

  private findDownloadedFile(refId: string): string | undefined {
    if (!existsSync(this.refsDir())) return undefined;
    const videoExt = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
    const match = readdirSync(this.refsDir()).find((f) => f.startsWith(refId) && videoExt.test(f));
    return match ? join(this.refsDir(), match) : undefined;
  }

  private async probe(filePath: string): Promise<{ width?: number; height?: number; fps?: number; duration?: number }> {
    const ffprobe = join(this.ffmpegDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    const out = await this.run(
      [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      60_000,
    );
    const data = JSON.parse(out) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[];
    };
    const video = (data.streams ?? []).find((s) => s.codec_type === "video");
    const parseRate = (r?: string): number | undefined => {
      if (!r) return undefined;
      const [n, d] = r.split("/").map(Number);
      return n && d ? n / d : Number(r) || undefined;
    };
    return {
      width: video?.width,
      height: video?.height,
      fps: parseRate(video?.avg_frame_rate),
      duration: Number(video?.duration ?? data.format?.duration) || undefined,
    };
  }

  private async thumbnail(filePath: string, posterPath: string, duration?: number): Promise<void> {
    const ffmpeg = join(this.ffmpegDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const t = Math.min(1, (duration ?? 1) * 0.25);
    await this.run(
      [ffmpeg, "-y", "-ss", String(t), "-i", filePath, "-frames:v", "1", "-vf", "scale=320:-1", posterPath],
      60_000,
    );
  }

  private async analyze(filePath: string): Promise<import("./store").ReferenceStyleCard> {
    const outFile = join(this.refsDir(), `${basename(filePath)}.style.json`);
    const out = await this.run(["python", this.script("analyze.py"), filePath, outFile], 120_000);
    const parsed = JSON.parse(out) as import("./store").ReferenceStyleCard;
    // Normalize the palette weight sum; drop colors below 1% weight.
    return {
      ...parsed,
      palette: parsed.palette.filter((c) => c.weight >= 0.01).slice(0, 6),
    };
  }

  private async transcribe(filePath: string): Promise<import("./store").ReferenceTranscript> {
    const outFile = join(this.refsDir(), `${basename(filePath)}.transcript.json`);
    const args = ["python", this.script("transcribe.py"), filePath, outFile, "--model", this.whisperModel];
    if (this.whisperLanguage) args.push("--language", this.whisperLanguage);
    await this.run(args, 15 * 60_000);
    const { readFileSync } = await import("node:fs");
    return JSON.parse(readFileSync(outFile, "utf-8")) as import("./store").ReferenceTranscript;
  }
}

function guessTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return `Reference from ${host}`;
  } catch {
    return "Reference video";
  }
}