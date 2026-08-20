import argparse
import json
import statistics
import sys
from collections import Counter

import av
import numpy as np

THUMB_W, THUMB_H = 48, 27
SCENE_DIFF_THRESHOLD = 0.32
MAX_SAMPLES = 240
PALETTE_SIZE = 8


def quantize_code(arr: np.ndarray) -> np.ndarray:
    # 3 bits per channel packed into one byte.
    return ((arr[:, :, 0] >> 5) << 4) | ((arr[:, :, 1] >> 5) << 2) | (arr[:, :, 2] >> 5)


def unhex(code: int) -> str:
    r = ((code >> 4) & 7) * 32 + 16
    g = ((code >> 2) & 7) * 32 + 16
    b = (code & 7) * 32 + 16
    return f"{r:02x}{g:02x}{b:02x}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    args = ap.parse_args()

    container = av.open(args.video)
    stream = container.streams.video[0]
    fps = float(stream.average_rate or 0) or 30.0
    duration = float(container.duration) / av.time_base if container.duration else 0.0
    width, height = int(stream.width), int(stream.height)
    total_frames = stream.frames or int(duration * fps)

    sample_step = max(1, int(total_frames / MAX_SAMPLES)) if total_frames else 1
    lums: list[float] = []
    colors: Counter = Counter()
    diffs: list[float] = []
    prev: np.ndarray | None = None

    for i, frame in enumerate(container.decode(video=0)):
        if i % sample_step != 0:
            continue
        if len(lums) >= MAX_SAMPLES:
            break
        try:
            small = frame.reformat(width=THUMB_W, height=THUMB_H)
        except Exception:
            small = frame
        arr = small.to_ndarray(format="rgb24").astype(np.float32)
        lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
        lums.append(float(lum.mean() / 255.0))
        colors.update(quantize_code(arr.astype(np.uint8)).ravel().tolist())
        if prev is not None:
            diffs.append(float(np.abs(arr - prev).mean() / 255.0))
        prev = arr

    cuts = sum(1 for d in diffs if d > SCENE_DIFF_THRESHOLD)
    avg_shot = (duration / max(1, cuts + 1)) if duration else 0.0
    pace = "slow" if avg_shot >= 4 else ("steady" if avg_shot >= 2 else "fast")
    motion = min(1.0, statistics.mean(diffs) / 0.12) if diffs else 0.0

    total_px = sum(colors.values()) or 1
    palette = [
        {"hex": unhex(code), "weight": round(w / total_px, 3)}
        for code, w in colors.most_common(PALETTE_SIZE)
    ]

    out = {
        "duration": round(duration, 3),
        "fps": round(fps, 3),
        "width": width,
        "height": height,
        "cuts": cuts,
        "avgShotLength": round(avg_shot, 2),
        "pace": pace,
        "palette": palette,
        "avgLuminance": round(statistics.mean(lums), 3) if lums else 0.0,
        "motion": round(motion, 3),
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())