import type { Category } from "@sabacos/core";

const RULES: [RegExp, string][] = [
  [/skin|derm|ቆዳ/i, "🧴"],
  [/hair|shamp|wig|ፀጉር/i, "💇"],
  [/lip|ከንፈር/i, "💋"],
  [/eye|lash|brow|ዓይን/i, "👁"],
  [/face|serum|cream|ፊት/i, "🧖"],
  [/fragrance|perfume|scent|መዓዛ/i, "🌸"],
  [/nail|polish|ጥᑭት/i, "💅"],
  [/makeup|cosmet|beauty|ሜኪያፕ|ቆዳ ንክሸት/i, "💄"],
  [/bath|soap|body|ገጽታ/i, "🛁"],
];

export function iconForCategory(category: Pick<Category, "slug" | "nameEn" | "nameAm">): string {
  const haystack = `${category.slug} ${category.nameEn} ${category.nameAm}`;
  for (const [pattern, icon] of RULES) {
    if (pattern.test(haystack)) return icon;
  }
  return "✨";
}
