"""Sabacos 30-day campaign builder.
Reads parts/*.json -> writes posts.json + CALENDAR.md (repo, committed),
renders 1080x1350 post cards to the Temp output dir (not committed).
Usage: python marketing/30-day-launch/build.py
"""
import json
import glob
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
PARTS = sorted(glob.glob(os.path.join(ROOT, "parts", "*.json")))
OUT_MD = os.path.join(ROOT, "CALENDAR.md")
OUT_JSON = os.path.join(ROOT, "posts.json")
OUT_DIR = r"C:\Users\pickachu\AppData\Local\Temp\opencode\sabacos-30day\cards"

W, H = 1080, 1350
FOOTER = "SABACOS - 100% ORIGINAL - t.me/sabacosbot"
CTA_EN = "Shop inside Telegram: t.me/sabacosbot"
CTA_AM = "በቴሌግራም ውስጥ ይግዙ: t.me/sabacosbot"
TAGS_DEFAULT = ["#Sabacos", "#AddisAbaba", "#HabeshaBeauty", "#OriginalOnly"]

FONTS_DIR = r"C:\Windows\Fonts"
HEAD_CANDIDATES = ["impact.ttf", "ariblk.ttf", "arialbd.ttf"]
BODY_FONT = "arialbd.ttf"
AM_FONT = "nyala.ttf"


def pick(name_list):
    for n in name_list:
        p = os.path.join(FONTS_DIR, n)
        if os.path.exists(p):
            return p
    raise FileNotFoundError("none of %s found" % (name_list,))


HEAD_FONT_PATH = pick(HEAD_CANDIDATES)
BODY_FONT_PATH = pick([BODY_FONT])
AM_FONT_PATH = pick([AM_FONT])


def font(path, size):
    return ImageFont.truetype(path, size)


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        trial = (cur + " " + w_).strip()
        if draw.textbbox((0, 0), trial, font=fnt)[2] <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def block_height(draw, lines, fnt, spacing=8):
    h = 0
    for ln in lines:
        bb = draw.textbbox((0, 0), ln, font=fnt)
        h += (bb[3] - bb[1]) + spacing
    return h - spacing if lines else 0


def fit_headline(draw, text, max_w, start=150, max_h=10 ** 9):
    size = start
    while size > 40:
        f = font(HEAD_FONT_PATH, size)
        lines = wrap(draw, text, f, max_w)
        if (all(draw.textbbox((0, 0), ln, font=f)[2] <= max_w for ln in lines)
                and block_height(draw, lines, f, 6) <= max_h):
            return f, lines
        size -= 6
    f = font(HEAD_FONT_PATH, 40)
    return f, wrap(draw, text, f, max_w)


WEEK_THEMES = [
    (1, 7, "WEEK 1 - LAUNCH: Addis, your glow plug is here"),
    (8, 14, "WEEK 2 - PRODUCT: campus glow on a budget"),
    (15, 21, "WEEK 3 - MONEY: your phone is your salary"),
    (22, 30, "WEEK 4 - TRUST + FINALE: proof, party, payout"),
]


def week_theme(day_no):
    for start, end, name in WEEK_THEMES:
        if start <= day_no <= end:
            return name
    return ""


def lum(hexcolor):
    h = hexcolor.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def contrast(hexcolor):
    return "#FFFFFF" if lum(hexcolor) < 0.55 else "#141414"


def draw_centered(draw, cx, y, lines, fnt, fill, spacing=8):
    for ln in lines:
        bb = draw.textbbox((0, 0), ln, font=fnt)
        draw.text((cx - (bb[2] - bb[0]) / 2 - bb[0], y), ln, font=fnt, fill=fill)
        y += (bb[3] - bb[1]) + spacing
    return y


def render_slide(day, idx, slide, design, total):
    bg = design.get("bg", "#F3EAD8")
    ink = design.get("ink", "#141414")
    accent = design.get("accent", "#C8102E")
    layout = design.get("layout", "bold")
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    body = font(BODY_FONT_PATH, 34)
    am_f = font(AM_FONT_PATH, 36)
    kick_f = font(BODY_FONT_PATH, 30)

    BAND_H = 560
    FOOT_H = 110
    if layout == "split":
        d.rectangle([0, 0, W, BAND_H], fill=accent)
        band_ink = contrast(accent)
        kick_lines = wrap(d, slide.get("kicker", ""), kick_f, W - 140)
        kh = block_height(d, kick_lines, kick_f)
        hf, hlines = fit_headline(d, slide.get("headline", ""), W - 120,
                                  start=120, max_h=BAND_H - 110 - kh - 30)
        hh = block_height(d, hlines, hf, 6)
        y = 90 + max(0, (BAND_H - 110 - kh - hh) // 2)
        y = draw_centered(d, W / 2, y, kick_lines, kick_f, band_ink)
        y = draw_centered(d, W / 2, y + 10, hlines, hf, band_ink, spacing=6)
        # lower block (sub + am) centered in remaining space
        sub_lines = wrap(d, slide.get("sub", ""), body, W - 160)
        am_lines = wrap(d, slide.get("am", ""), am_f, W - 160) if slide.get("am") else []
        total = (block_height(d, sub_lines, body)
                 + (16 + block_height(d, am_lines, am_f) if am_lines else 0))
        top, bottom = BAND_H + 40, H - FOOT_H - 40
        y = top + max(0, (bottom - top - total) // 2)
        y = draw_centered(d, W / 2, y, sub_lines, body, ink)
        if am_lines:
            draw_centered(d, W / 2, y + 16, am_lines, am_f, ink)
    else:
        kick_lines = wrap(d, slide.get("kicker", ""), kick_f, W - 140)
        hf, hlines = fit_headline(d, slide.get("headline", ""), W - 120)
        sub_lines = wrap(d, slide.get("sub", ""), body, W - 160)
        am_lines = wrap(d, slide.get("am", ""), am_f, W - 160) if slide.get("am") else []
        bottom = H - FOOT_H - (150 if total > 1 else 60)
        total = (block_height(d, kick_lines, kick_f) + 24
                 + block_height(d, hlines, hf, 10) + 30
                 + block_height(d, sub_lines, body)
                 + (16 + block_height(d, am_lines, am_f) if am_lines else 0))
        y = 100 + max(0, (bottom - 100 - total) // 2)
        y = draw_centered(d, W / 2, y, kick_lines, kick_f, accent)
        y = draw_centered(d, W / 2, y + 24, hlines, hf, ink, spacing=10)
        y = draw_centered(d, W / 2, y + 30, sub_lines, body, ink)
        if am_lines:
            draw_centered(d, W / 2, y + 16, am_lines, am_f, ink)

    if total > 1:
        dots = "  ".join("●" if i == idx else "○" for i in range(total))
        df = font(BODY_FONT_PATH, 28)
        bb = d.textbbox((0, 0), dots, font=df)
        d.text(((W - (bb[2] - bb[0])) / 2 - bb[0], H - 200), dots, font=df, fill=accent)

    # footer bar
    d.rectangle([0, H - 110, W, H], fill=accent)
    ff = font(BODY_FONT_PATH, 30)
    foot_ink = contrast(accent)
    bb = d.textbbox((0, 0), FOOTER, font=ff)
    d.text(((W - (bb[2] - bb[0])) / 2 - bb[0], H - 110 + (110 - (bb[3] - bb[1])) / 2 - bb[1]),
           FOOTER, font=ff, fill=foot_ink)
    return img


def main():
    days = []
    for p in PARTS:
        with open(p, encoding="utf-8") as f:
            days.extend(json.load(f)["days"])
    days.sort(key=lambda x: x["day"])
    assert [x["day"] for x in days] == list(range(1, 31)), "need days 1-30"
    for x in days:
        x["week_theme"] = week_theme(x["day"])

    campaign = {
        "campaign": "Sabacos Mini-App Launch - 30-Day Content",
        "audience": "Women in Addis Ababa, university students, young professionals",
        "cta_default": {"en": CTA_EN, "am": CTA_AM},
        "hashtags_default": TAGS_DEFAULT,
        "days": days,
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(campaign, f, ensure_ascii=False, indent=1)

    # ---- calendar markdown ----
    L = ["# Sabacos Mini-App Launch - 30-Day Content Calendar",
         "",
         "Audience: women in Addis Ababa, university students, young professionals.",
         "Post 1x/day on Telegram channel + Instagram/TikTok. Carousel = swipe slides.",
         "Default CTA (append to every caption):",
         "",
         "- EN: %s" % CTA_EN,
         "- AM: %s" % CTA_AM,
         ""]
    last_theme = None
    for day in days:
        if day.get("week_theme") != last_theme and day.get("week_theme"):
            L += ["---", "", "## %s" % day["week_theme"], ""]
            last_theme = day.get("week_theme")
        L += ["### Day %d (%s)" % (day["day"], day["format"])]
        for i, s in enumerate(day["slides"]):
            L += ["",
                  "**Slide %d**" % (i + 1),
                  "- Kicker: %s" % s.get("kicker", ""),
                  "- Headline: %s" % s.get("headline", ""),
                  "- Sub: %s" % s.get("sub", "")]
            if s.get("am"):
                L += ["- AM: %s" % s["am"]]
        L += ["",
              "Caption EN: %s" % day["caption_en"],
              "",
              "Caption AM: %s" % day["caption_am"],
              "",
              "Hashtags: %s" % " ".join(TAGS_DEFAULT + day.get("hashtags", [])),
              "Design: bg %s, ink %s, accent %s, layout %s" % (
                  day["design"]["bg"], day["design"]["ink"],
                  day["design"]["accent"], day["design"]["layout"]),
              ""]
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    # ---- render cards ----
    os.makedirs(OUT_DIR, exist_ok=True)
    count = 0
    for day in days:
        total = len(day["slides"])
        for i, s in enumerate(day["slides"]):
            img = render_slide(day["day"], i, s, day["design"], total)
            name = "day%02d-s%d.png" % (day["day"], i + 1)
            img.save(os.path.join(OUT_DIR, name))
            count += 1
    print("days=%d cards=%d" % (len(days), count))
    print("json: %s" % OUT_JSON)
    print("calendar: %s" % OUT_MD)
    print("cards: %s" % OUT_DIR)
    print("headline font: %s" % HEAD_FONT_PATH)


if __name__ == "__main__":
    sys.exit(main())
