import { describe, expect, it } from "vitest";
import {
  SHARE_PHOTO_CAPTION_LIMIT,
  buildShareCaption,
  buildShareInlineResult,
  buildShareLink,
} from "../src/routes/share.js";

const WEBAPP = "https://sabacos-web.onrender.com";

const product = {
  id: "11111111-1111-4111-8111-111111111111",
  nameEn: "Glow Serum <b>Special</b>",
  nameAm: "ግሎው ሴረም",
  descriptionEn: "Brightening vitamin-C serum for daily glow.",
  descriptionAm: "",
  priceHalala: 150000,
  imageUrls: ["https://cdn.example.com/serum.jpg"],
};

describe("buildShareLink", () => {
  it("packs an attributed startapp link when the bot username is set", () => {
    const url = buildShareLink(WEBAPP, "sabacosbot", 8260464827, product.id);
    expect(url.startsWith("https://t.me/sabacosbot?startapp=s8260464827_")).toBe(true);
  });

  it("strips a leading @ from the bot username", () => {
    const url = buildShareLink(WEBAPP, "@sabacosbot", 1, product.id);
    expect(url.startsWith("https://t.me/sabacosbot?startapp=")).toBe(true);
  });

  it("falls back to the plain product link without a username", () => {
    expect(buildShareLink(WEBAPP, undefined, 1, product.id)).toBe(
      `${WEBAPP}/product/${product.id}`,
    );
    expect(buildShareLink(`${WEBAPP}/`, "", 1, product.id)).toBe(
      `${WEBAPP}/product/${product.id}`,
    );
  });
});

describe("buildShareCaption", () => {
  it("mentions name, price and the half-now option", () => {
    const caption = buildShareCaption(product);
    expect(caption).toContain("Glow Serum");
    expect(caption).toContain("1,500.00");
    expect(caption).toContain("750.00");
  });
});

describe("buildShareInlineResult", () => {
  it("builds a photo result with caption + buy button", () => {
    const url = `${WEBAPP}/product/${product.id}`;
    const result = buildShareInlineResult(product, url) as unknown as {
      type: string;
      photo_url: string;
      caption: string;
      parse_mode?: string;
      reply_markup?: unknown;
    };
    expect(result.type).toBe("photo");
    expect(result.photo_url).toBe(product.imageUrls[0]);
    expect(result.parse_mode).toBe("HTML");
    // Raw caption (after entities parsing) must fit Telegram's 1024 limit…
    const raw = result.caption.replace(/&(amp|lt|gt|quot|#39);/g, "x");
    expect(raw.length).toBeLessThanOrEqual(SHARE_PHOTO_CAPTION_LIMIT);
    // …still carry the attributed link…
    expect(result.caption).toContain(url);
    // …escape HTML from product fields…
    expect(result.caption).toContain("&lt;b&gt;Special&lt;/b&gt;");
    expect(result.reply_markup).toEqual({
      inline_keyboard: [[{ text: "🛍  Buy now", url }]],
    });
  });

  it("builds an article result when the product has no image", () => {
    const url = `${WEBAPP}/product/${product.id}`;
    const result = buildShareInlineResult({ ...product, imageUrls: [] }, url) as unknown as {
      type: string;
      title: string;
      input_message_content: { message_text: string; parse_mode?: string };
      reply_markup?: unknown;
    };
    expect(result.type).toBe("article");
    expect(result.title).toBe(product.nameEn);
    const content = result.input_message_content;
    expect(content.message_text).toContain(url);
    expect(content.parse_mode).toBe("HTML");
    expect(result.reply_markup).toEqual({
      inline_keyboard: [[{ text: "🛍  Buy now", url }]],
    });
  });
});
