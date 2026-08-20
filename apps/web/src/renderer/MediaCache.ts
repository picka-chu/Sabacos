import { Texture, VideoSource } from "pixi.js";
import type { LayerKind, MediaAsset, MediaSource } from "@motion/core";

export type ResolvedMedia =
  | { kind: "texture"; texture: Texture }
  | { kind: "video"; texture: Texture; video: HTMLVideoElement }
  | { kind: "audio"; url: string }
  | { kind: "missing" };

export type MediaResolver = (source: MediaSource, kind: LayerKind) => Promise<ResolvedMedia>;

/**
 * Resolves document MediaSources (project media by id, or raw urls) to
 * Pixi display resources. Image textures are cached per url; video layers
 * get a seekable <video> element backed by a non-auto-updating VideoSource.
 */
export function createMediaResolver(media: MediaAsset[]): MediaResolver {
  const urlOf = (source: MediaSource): string | null => {
    if (source.type === "url") return source.url;
    const asset = media.find((m) => m.id === source.mediaId);
    return asset?.url ?? null;
  };

  const cache = new Map<string, ResolvedMedia>();

  return async (source, kind): Promise<ResolvedMedia> => {
    const url = urlOf(source);
    if (!url) return { kind: "missing" };
    const cached = cache.get(url);
    if (cached) return cached;

    let resolved: ResolvedMedia;
    if (kind === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      });
      resolved = { kind: "texture", texture: Texture.from(img) };
    } else if (kind === "video") {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      const sourceTexture = new VideoSource({
        resource: video,
        autoPlay: false,
      });
      sourceTexture.autoUpdate = false;
      resolved = {
        kind: "video",
        texture: new Texture({ source: sourceTexture }),
        video,
      };
    } else {
      resolved = { kind: "audio", url };
    }

    cache.set(url, resolved);
    return resolved;
  };
}
