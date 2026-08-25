const isProd = process.env.NODE_ENV === "production";

function fmt(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  return isProd ? JSON.stringify({ ts, level, msg }) : `${ts} [${level}] ${msg}`;
}

export const log = {
  info: (...args: unknown[]) => console.log(fmt("info", args)),
  warn: (...args: unknown[]) => console.warn(fmt("warn", args)),
  error: (...args: unknown[]) => console.error(fmt("error", args)),
  debug: (...args: unknown[]) => {
    if (!isProd) console.log(fmt("debug", args));
  },
};
