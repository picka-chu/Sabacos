/**
 * Mini-app URL helpers. Telegram's web_app buttons (reply-keyboard and
 * inline) open exactly the URL string they carry, so every entry point —
 * Shop keyboard button, menu button, broadcast buttons — must share one
 * normalized base. See https://core.telegram.org/bots/webapps
 */

/** Join the mini-app base URL with an in-app path (no double slashes). */
export function webAppUrl(base: string, path = ""): string {
  const cleanBase = base.trim().replace(/\/+$/, "");
  if (!path) return cleanBase;
  const cleanPath = path.trim();
  if (!cleanPath) return cleanBase;
  return `${cleanBase}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`;
}

/**
 * Fail-soft validation for a web_app URL. Returns human-readable problems
 * (empty = looks good). Telegram requires an HTTPS URL; anything else makes
 * every web_app button in the bot silently do nothing.
 */
export function validateWebAppUrl(label: string, raw: string | undefined): string[] {
  const problems: string[] = [];
  const value = (raw ?? "").trim();
  if (!value) {
    problems.push(`${label} is empty — web_app buttons will have no URL to open`);
    return problems;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(value);
  } catch {
    problems.push(`${label} is not a valid URL: "${value}"`);
    return problems;
  }
  if (parsed.protocol !== "https:") {
    problems.push(
      `${label} must be HTTPS for Telegram web_app buttons (got "${parsed.protocol}//${parsed.host}")`,
    );
  }
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    problems.push(`${label} points at localhost — Telegram clients cannot reach it`);
  }
  if (/\s/.test(value)) {
    problems.push(`${label} contains whitespace — Telegram will reject the button URL`);
  }
  return problems;
}

/**
 * Heuristic misconfiguration check: the mini-app host must not be the API
 * server itself (that serves JSON, so the webview opens to a blank page and
 * every Shop/menu/broadcast button looks "broken").
 */
export function webAppPointsAtApi(webappUrl: string | undefined, apiUrl: string | undefined): boolean {
  try {
    const webHost = new URL((webappUrl ?? "").trim()).host;
    const apiHost = new URL((apiUrl ?? "").trim()).host;
    return Boolean(webHost) && webHost === apiHost;
  } catch {
    return false;
  }
}
