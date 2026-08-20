import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SEED_ADMIN_EMAIL: z.string().email().optional().default(""),
  SEED_ADMIN_PASSWORD: z.string().optional().default(""),
});

const env = envSchema.parse(process.env);

const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SETTINGS = {
  delivery_fee_halala: 12000,
  free_delivery_threshold_halala: 150000,
  shop_name_en: "Sabacos",
  shop_name_am: "ሳባኮስ",
  shop_phone: "+251900000000",
  admin_channel_id: null,
};

const CATEGORIES = [
  { slug: "skincare", name_en: "Skincare", name_am: "የቆዳ እንክብካቤ", sort_order: 1 },
  { slug: "makeup", name_en: "Makeup", name_am: "መዋቢያ", sort_order: 2 },
  { slug: "haircare", name_en: "Haircare", name_am: "የፀጉር እንክብካቤ", sort_order: 3 },
  { slug: "fragrance", name_en: "Fragrance", name_am: "ሽቶ", sort_order: 4 },
  { slug: "body-care", name_en: "Body Care", name_am: "የሰውነት እንክብካቤ", sort_order: 5 },
] as const;

const img = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=80`;

const PRODUCTS: Array<{
  sku: string;
  category: (typeof CATEGORIES)[number]["slug"];
  name_en: string;
  name_am: string;
  description_en: string;
  description_am: string;
  price_etb: number;
  compare_at_etb: number | null;
  stock: number;
  featured: boolean;
  images: string[];
}> = [
  {
    sku: "SB-SK-001",
    category: "skincare",
    name_en: "Rose Hydrating Face Serum",
    name_am: "የሮዝ ሃይድሬቲንግ ፊት ሴረም",
    description_en:
      "A silky rose-infused serum that deeply hydrates and leaves skin glowing. Suitable for all skin types.",
    description_am:
      "ቆዳን በጥልቀት የሚያጠምቅ እና የሚያብረቀርቅ የሮዝ ሴረም። ለሁሉም የቆዳ አይነቶች ተስማሚ።",
    price_etb: 850,
    compare_at_etb: 950,
    stock: 24,
    featured: true,
    images: [img("photo-1571781926291-c477ebfd024b"), img("photo-1556228720-195a672e8a03")],
  },
  {
    sku: "SB-SK-002",
    category: "skincare",
    name_en: "Vitamin C Brightening Cream",
    name_am: "ቫይታሚን ሲ ብራይትኒንግ ክሬም",
    description_en:
      "Lightweight day cream with Vitamin C to brighten, even tone, and protect against daily dullness.",
    description_am:
      "ቆዳን የሚያበራ፣ ቀለምን የሚያስተካክል ቀላል የቀን ክሬም።",
    price_etb: 650,
    compare_at_etb: null,
    stock: 18,
    featured: true,
    images: [img("photo-1598440947619-2c35fc9aa908"), img("photo-1596462502278-27bfdc403348")],
  },
  {
    sku: "SB-MU-001",
    category: "makeup",
    name_en: "Silk Matte Lipstick — Rose",
    name_am: "ሲልክ ማቲ ሊፕስቲክ — ሮዝ",
    description_en:
      "A creamy matte lipstick in a timeless rose shade. Long-wearing with a velvety finish.",
    description_am:
      "ዘላቂ እና ለስላሳ የሮዝ ቀለም ሊፕስቲክ።",
    price_etb: 350,
    compare_at_etb: 420,
    stock: 40,
    featured: true,
    images: [img("photo-1586495777744-4413f21062fa"), img("photo-1512496015851-a90fb38ba796")],
  },
  {
    sku: "SB-MU-002",
    category: "makeup",
    name_en: "24H Setting Powder",
    name_am: "24 ሰአት ሴቲንግ ፓውደር",
    description_en:
      "Translucent finishing powder that sets makeup and controls shine all day without a flashback.",
    description_am:
      "መዋቢያን የሚያስተካክል እና ቀኑን ሙሉ የሚያጸዳ ፓውደር።",
    price_etb: 420,
    compare_at_etb: null,
    stock: 30,
    featured: false,
    images: [img("photo-1596462502278-27bfdc403348"), img("photo-1571781926291-c477ebfd024b")],
  },
  {
    sku: "SB-HC-001",
    category: "haircare",
    name_en: "Argan Nourishing Hair Oil",
    name_am: "አርጋን የፀጉር ዘይት",
    description_en:
      "Pure argan oil that repairs, softens, and adds shine to dry and damaged hair.",
    description_am:
      "ደረቅ እና የተጎዳ ፀጉርን የሚጠግን ንጹህ አርጋን ዘይት።",
    price_etb: 550,
    compare_at_etb: 620,
    stock: 22,
    featured: true,
    images: [img("photo-1526947425960-945c6e72858f"), img("photo-1585750243586-2c3b4c1c0c8b")],
  },
  {
    sku: "SB-SK-003",
    category: "skincare",
    name_en: "Gentle Cleansing Foam",
    name_am: "እንክብካቤ ፎም",
    description_en:
      "A gentle, pH-balanced cleansing foam that removes impurities without stripping the skin.",
    description_am:
      "ቆዳን ሳይጎዳ ቆሻሻን የሚያስወግድ ለስላሳ ፎም።",
    price_etb: 300,
    compare_at_etb: null,
    stock: 35,
    featured: false,
    images: [img("photo-1556228578-8c89e6adf883"), img("photo-1596755094514-f87e34085b2c")],
  },
  {
    sku: "SB-BC-001",
    category: "body-care",
    name_en: "Shea Butter Body Cream",
    name_am: "ሺአ ቅቤ የሰውነት ክሬም",
    description_en:
      "Rich shea butter cream for deep, lasting moisturization and softer skin.",
    description_am:
      "ቆዳን በጥልቀት የሚያረጥብ የሺአ ቅቤ ክሬም።",
    price_etb: 480,
    compare_at_etb: 540,
    stock: 26,
    featured: false,
    images: [img("photo-1608248543803-ba4f8c70ae0b"), img("photo-1571781926291-c477ebfd024b")],
  },
  {
    sku: "SB-FR-001",
    category: "fragrance",
    name_en: "Amber & Oud Eau de Parfum",
    name_am: "አምበር እና ኡድ ሽቶ",
    description_en:
      "A warm, sophisticated blend of amber, oud, and soft florals. Long-lasting, 50ml.",
    description_am:
      "ሞቃታማ እና ዘላቂ የአምበር እና ኡድ ሽቶ። 50ሚሊ።",
    price_etb: 1200,
    compare_at_etb: null,
    stock: 12,
    featured: true,
    images: [img("photo-1541643600914-78b084683601"), img("photo-1587017539504-67cfbddac569")],
  },
  {
    sku: "SB-SK-004",
    category: "skincare",
    name_en: "Charcoal Purifying Mask",
    name_am: "ቻርኮል ማስክ",
    description_en:
      "Detoxifying clay mask with charcoal to draw out impurities and refine pores.",
    description_am:
      "ቆዳን የሚያጸዳ እና የፎቶዎችን መጠን የሚቀንስ ክሌይ ማስክ።",
    price_etb: 250,
    compare_at_etb: 300,
    stock: 28,
    featured: false,
    images: [img("photo-1571875257727-256c39da42af"), img("photo-1556229010-6c3f2c9ca5f8")],
  },
  {
    sku: "SB-MU-003",
    category: "makeup",
    name_en: "Nourishing Lip Balm",
    name_am: "ለስላሳ ከንፈር ባልም",
    description_en:
      "Hydrating balm with shea and vitamin E to soften and protect lips.",
    description_am:
      "ከንፈርን የሚያረጥብ እና የሚጠብቅ ባልም።",
    price_etb: 180,
    compare_at_etb: null,
    stock: 50,
    featured: false,
    images: [img("photo-1599733594230-6b8235f77057"), img("photo-1586495777744-4413f21062fa")],
  },
];

async function upsertSettings(): Promise<void> {
  const { error } = await client.from("settings").upsert(
    { key: "store", value: SETTINGS },
    { onConflict: "key" },
  );
  if (error) throw new Error(`settings: ${error.message}`);
  console.log("✓ settings");
}

async function seedCategories(): Promise<Record<string, string>> {
  const bySlug: Record<string, string> = {};
  const { data: existing } = await client.from("categories").select("id, slug");
  for (const c of existing ?? []) bySlug[c.slug as string] = c.id as string;

  for (const cat of CATEGORIES) {
    if (bySlug[cat.slug]) continue;
    const { data, error } = await client
      .from("categories")
      .insert({
        slug: cat.slug,
        name_en: cat.name_en,
        name_am: cat.name_am,
        sort_order: cat.sort_order,
        is_active: true,
      })
      .select("id, slug")
      .single();
    if (error) throw new Error(`category ${cat.slug}: ${error.message}`);
    bySlug[cat.slug] = data.id;
  }
  console.log(`✓ categories (${Object.keys(bySlug).length})`);
  return bySlug;
}

async function seedProducts(categoryIds: Record<string, string>): Promise<void> {
  const { data: existing } = await client.from("products").select("sku");
  const existingSkus = new Set((existing ?? []).map((p) => p.sku as string));

  for (const p of PRODUCTS) {
    if (existingSkus.has(p.sku)) continue;
    const { error } = await client.from("products").insert({
      sku: p.sku,
      category_id: categoryIds[p.category],
      name_en: p.name_en,
      name_am: p.name_am,
      description_en: p.description_en,
      description_am: p.description_am,
      price_halala: Math.round(p.price_etb * 100),
      compare_at_halala: p.compare_at_etb == null ? null : Math.round(p.compare_at_etb * 100),
      stock: p.stock,
      image_urls: p.images,
      is_active: true,
      is_featured: p.featured,
    });
    if (error) throw new Error(`product ${p.sku}: ${error.message}`);
  }
  console.log(`✓ products (${PRODUCTS.length})`);
}

async function seedAdmin(): Promise<void> {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.log("  admin: skipped (set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)");
    return;
  }

  const { data: byEmail, error: lookupError } = await client.auth.admin.listUsers();
  if (lookupError) throw new Error(`admin lookup: ${lookupError.message}`);

  let authUserId = byEmail.users.find((u) => u.email === env.SEED_ADMIN_EMAIL)?.id;
  if (!authUserId) {
    const { data: created, error } = await client.auth.admin.createUser({
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`admin createUser: ${error.message}`);
    authUserId = created.user.id;
  }

  const { error: profileError } = await client.from("profiles").upsert(
    {
      id: authUserId,
      telegram_id: null,
      username: null,
      first_name: "Sabacos",
      last_name: "Admin",
      role: "admin",
    },
    { onConflict: "id" },
  );
  if (profileError) throw new Error(`admin profile: ${profileError.message}`);
  console.log(`✓ admin: ${env.SEED_ADMIN_EMAIL}`);
}

async function main(): Promise<void> {
  console.log("Seeding Sabacos…");
  await upsertSettings();
  const categoryIds = await seedCategories();
  await seedProducts(categoryIds);
  await seedAdmin();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});