import argparse
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--model", default="base")
    ap.add_argument("--language", default=None)
    args = ap.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.video,
        language=args.language,
        vad_filter=True,
        condition_on_previous_text=True,
    )
    out = {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "segments": [
            {"start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip()}
            for seg in segments
        ],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(json.dumps({"ok": True, "segments": len(out["segments"]), "language": out["language"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())