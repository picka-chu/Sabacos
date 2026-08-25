import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { AppEnv } from "../env.js";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
}

/** R2 is used when all four env vars are set; otherwise Supabase Storage. */
export function r2Config(env: AppEnv): R2Config | null {
  if (
    env.CLOUDFLARE_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET &&
    env.R2_PUBLIC_BASE
  ) {
    return {
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      publicBase: env.R2_PUBLIC_BASE.replace(/\/$/, ""),
    };
  }
  return null;
}

let cached: { client: S3Client; key: string } | null = null;

function configKey(cfg: R2Config): string {
  return `${cfg.accountId}:${cfg.accessKeyId}:${cfg.bucket}:${cfg.publicBase}`;
}

function getClient(cfg: R2Config): S3Client {
  const key = configKey(cfg);
  if (cached && cached.key === key) return cached.client;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  cached = { client, key };
  return client;
}

export async function r2Put(
  cfg: R2Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const client = getClient(cfg);
  await client.send(
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return `${cfg.publicBase}/${key}`;
}

export async function r2Delete(cfg: R2Config, key: string): Promise<void> {
  const client = getClient(cfg);
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}
