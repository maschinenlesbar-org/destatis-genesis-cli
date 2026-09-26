// The request engine: turns logical (path, params) calls into HTTP requests via a
// Transport, applies retry/backoff for transient statuses (429, 503), decodes
// responses, and — crucially for GENESIS — inspects the `Status` object in a
// *successful* (HTTP 200) body to surface logical errors.
//
// Transport shape (verified against the live 2020 endpoint): authenticated calls
// are **POST** with an `application/x-www-form-urlencoded` body carrying the
// parameters, and credentials in HTTP **header** fields (`username`, and
// `password` when not using a token). The legacy GET-with-query-param-credentials
// style is no longer honoured by the server (it 302-redirects to an announcement
// page). Only `helloworld/whoami` is an unauthenticated GET.

import { nodeHttpTransport, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import { DestatisApiError, DestatisNetworkError, DestatisParseError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://genesis.destatis.de";
const DEFAULT_USER_AGENT = "destatis-genesis-cli";
// The charset is REQUIRED: without it GENESIS decodes the body as Latin-1, so a
// UTF-8 umlaut (e.g. "Bevölkerung") arrives mojibaked and matches nothing.
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=UTF-8";

// GENESIS logical `Status.Code` values this engine acts on. All others (0 ok,
// 22 ok-with-auto-correction, 50 no-newer-data, ...) are returned as-is so the
// caller sees the full envelope (Status.Content carries any warning text).
const CODE_NOT_FOUND = 90; // requested object does not exist
const CODE_TOO_LARGE = 98; // result too large for a synchronous fetch (needs the async job flow)
const CODE_EMPTY = 104; // no object matched the selection/search — a valid *empty* result

export interface RawResponse {
  data: Buffer;
  contentType: string;
  status: number;
}

export interface EngineOptions {
  /** Base URL of the API. Defaults to https://genesis.destatis.de */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /** Value of the User-Agent header. */
  userAgent?: string;
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * Time limit per request in milliseconds, covering the whole response body, not
   * only idle gaps (0 disables; capped at MAX_TIMEOUT_MS, 2^31 - 1 ms).
   */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses. Each waits the
   * response's `Retry-After` (up to `MAX_RETRY_AFTER_MS`; a longer one is not
   * retried), or else `retryDelayMs * attempt`.
   */
  maxRetries?: number;
  /** Base backoff between retries in milliseconds (grows linearly); used without a Retry-After. */
  retryDelayMs?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

/**
 * Longest `Retry-After` the engine waits out before retrying a 429/503. When the
 * server asks for longer, the engine does not retry at all and surfaces the error at
 * once: retrying early would only land inside the window the server asked us to wait
 * out, and a hostile value must not stall the CLI.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

/** An IMF-fixdate (RFC 9110 §5.6.7), the one HTTP-date form senders must generate. */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parse a `Retry-After` header into a delay in milliseconds (RFC 9110 §10.2.3):
 * either delay-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`,
 * turned into the time left from `now`; a date in the past gives 0).
 *
 * Returns `undefined` when the header is absent or malformed — negative (`"-1"`),
 * fractional (`"1.5"`), padded inside, any other date format — so the caller falls
 * back to its own backoff. The strict patterns matter: `Date.parse` alone would
 * read `"1.5"` as a date in 2001 and retry at once.
 */
export function parseRetryAfter(
  header: string | string[] | undefined,
  now: number = Date.now(),
): number | undefined {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (value === undefined || value === "") return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!IMF_FIXDATE.test(value)) return undefined;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - now);
}

/**
 * Reject a base URL whose scheme is not http(s). The default transport already
 * gates this per hop, but the engine is exported as a library and may be handed a
 * custom transport that does no such check, so gate the configured base URL here
 * too (a `file:`/`ftp:` base URL fails fast with a typed error). The URL in the
 * message goes through `redactUrl`, as every other URL this engine reports does.
 */
function assertHttpScheme(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new DestatisNetworkError(`Invalid base URL: ${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DestatisNetworkError(
      `Unsupported protocol "${url.protocol}" in base URL: ${redactUrl(baseUrl)}`,
    );
  }
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Strip terminal control characters from a server-controlled string before it
 * can reach stdout/stderr. A hostile or MITM'd endpoint can embed ANSI escape
 * sequences (or other C0/C1 controls) in `Status.Content`, a plain-text error
 * body, or the `Content-Type` header to spoof terminal output or abuse terminal
 * features. We drop C0 (0x00..0x08, 0x0B..0x1F), DEL (0x7F) and C1 (0x80..0x9F);
 * tab (0x09), newline (0x0A) and carriage return (0x0D) are kept so multi-line
 * messages survive. Implemented as a code-point filter so this source file never
 * contains a raw control byte.
 */
function sanitizeServerText(text: string): string {
  let out = "";
  for (const ch of text) {
    const n = ch.codePointAt(0) ?? 0;
    if (n === 0x09 || n === 0x0a || n === 0x0d) {
      out += ch;
      continue;
    }
    if (n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

/**
 * Mask credentials in a URL before it appears in an error message. Defensive:
 * this client sends credentials in headers (not the query string), but a caller
 * who overrides the transport or base URL could still put them in the URL, so
 * any URL surfaced in an error is scrubbed. Two channels are masked:
 *  - the `username` / `password` **query parameters** (legacy GENESIS style), and
 *  - the URL **userinfo** component (`https://user:pass@host`), which Node turns
 *    into a Basic `Authorization` header — otherwise `user:pass@` would leak
 *    verbatim into stderr / CI logs on any error.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    for (const key of ["username", "password"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "***");
    }
    // Strip any embedded userinfo so a credentialed base URL is not logged.
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/** The `{ Code, Content, Type }` status object of a GENESIS reply. */
interface GenesisStatus {
  Code?: unknown;
  Content?: unknown;
  Type?: unknown;
}

/**
 * Find the GENESIS status in a parsed body: the envelope's `Status` object, or a
 * flat top-level `{ Code, Content, Type }` (the auth-failure shape). Returns
 * undefined for anything else — including helloworld/logincheck, whose `Status`
 * is a plain string, and whoami, which has neither.
 */
function genesisStatus(parsed: unknown): GenesisStatus | undefined {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const top = parsed as GenesisStatus & { Status?: unknown };
  if (top.Status !== undefined) {
    return top.Status && typeof top.Status === "object" && !Array.isArray(top.Status)
      ? (top.Status as GenesisStatus)
      : undefined;
  }
  if (typeof top.Code === "number" && typeof top.Type === "string") return top;
  return undefined;
}

export class RequestEngine {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    assertHttpScheme(this.baseUrl);
    this.transport = options.transport ?? nodeHttpTransport;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Build a fully-qualified URL from a path (parameters travel in the body). */
  buildUrl(path: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${normalizedPath}`;
  }

  /**
   * Perform a request with Accept negotiation and transient-error retries. POST
   * requests carry `params` as a form-urlencoded body; GET requests take none.
   *
   * Redirects are deliberately NOT followed: the canonical host
   * (genesis.destatis.de) answers directly, and the legacy `www-genesis` host
   * cross-origin-redirects (307) — following that would forward credential
   * headers to another origin. A 3xx therefore surfaces as an error, with a hint
   * to use the canonical host.
   */
  private async request(
    method: "GET" | "POST",
    path: string,
    options: { params?: QueryParams; accept: string; authHeaders?: Record<string, string> },
  ): Promise<RawResponse> {
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Accept: options.accept,
      "User-Agent": this.userAgent,
      ...this.defaultHeaders,
      ...(options.authHeaders ?? {}),
    };

    let body: Buffer | undefined;
    if (method === "POST") {
      body = Buffer.from(buildQueryString(options.params ?? {}), "utf8");
      headers["Content-Type"] = FORM_CONTENT_TYPE;
      // Always set Content-Length (even 0) — GENESIS answers 411 to a POST
      // without one.
      headers["Content-Length"] = String(body.length);
    }

    let attempt = 0;
    for (;;) {
      const response = await this.transport({
        method,
        url,
        headers,
        ...(body !== undefined ? { body } : {}),
        timeoutMs: this.timeoutMs,
        ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
      });

      const status = response.status;
      const retryable = status === 429 || status === 503;
      if (retryable && attempt < this.maxRetries) {
        // Honour Retry-After; without a usable one, back off linearly. A Retry-After
        // beyond MAX_RETRY_AFTER_MS is not retried: the error below surfaces at once.
        const retryAfter = parseRetryAfter(response.headers["retry-after"]);
        if (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_MS) {
          attempt += 1;
          await this.sleep(retryAfter ?? this.retryDelayMs * attempt);
          continue;
        }
      }

      // Sanitize the server-controlled Content-Type at the source: it is echoed
      // to stderr by renderRaw, so strip any embedded terminal control chars.
      const contentType = sanitizeServerText(String(response.headers["content-type"] ?? ""));
      if (status < 200 || status >= 300) {
        throw this.toApiError(method, url, status, response.body);
      }

      return { data: response.body, contentType, status };
    }
  }

  /** GET a JSON body without credentials (helloworld/whoami). */
  async getJson<T>(path: string): Promise<T> {
    const res = await this.request("GET", path, { accept: "application/json" });
    return this.decodeJson<T>("GET", path, res);
  }

  /** POST form-encoded params (with credential headers) and parse the JSON reply. */
  async postJson<T>(
    path: string,
    params: QueryParams,
    authHeaders: Record<string, string>,
  ): Promise<T> {
    const res = await this.request("POST", path, { params, accept: "application/json", authHeaders });
    return this.decodeJson<T>("POST", path, res);
  }

  /**
   * POST form-encoded params and return the raw bytes (file / binary downloads).
   *
   * A `data/*file` endpoint answers with a file (a ZIP wrapper), so a JSON or
   * empty reply is never a download: it is a GENESIS status the server sent
   * instead of the file (a credential, "too large" or "no such object" reply),
   * and handing it back would let a caller save `{"Status":…}` as `x.xlsx`.
   *  - an empty body → `DestatisParseError`;
   *  - a JSON body with a GENESIS status (enveloped or flat) → the logical-error
   *    mapping (90, 98, error `Type`), and otherwise a `DestatisApiError` with
   *    that status — including `104` ("keine Objekte"), which for a download
   *    means "no such object" (`isNotFound`, exit 4 in the CLI);
   *  - any other JSON, or a body labelled JSON that does not parse →
   *    `DestatisParseError`.
   * A body counts as JSON when its Content-Type says so or it starts with `{`.
   */
  async postRaw(
    path: string,
    accept: string,
    params: QueryParams,
    authHeaders: Record<string, string>,
  ): Promise<RawResponse> {
    const res = await this.request("POST", path, { params, accept, authHeaders });
    if (res.data.length === 0) {
      throw new DestatisParseError(`Empty response body from ${path}: expected a file download.`);
    }
    const jsonType = /json/i.test(res.contentType);
    const text = res.data.toString("utf8");
    if (!jsonType && !text.trimStart().startsWith("{")) return res;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      if (!jsonType) return res; // starts with "{" but is not JSON: a real file
      throw new DestatisParseError(
        `Expected a file download from ${path}, got an unparseable reply labelled ${res.contentType}.`,
        { cause },
      );
    }
    const url = this.buildUrl(path);
    this.checkLogicalStatus("POST", url, text, parsed);
    const s = genesisStatus(parsed);
    if (s === undefined) {
      throw new DestatisParseError(
        `Expected a file download from ${path}, got a JSON reply without a GENESIS status.`,
      );
    }
    const code = typeof s.Code === "number" ? s.Code : undefined;
    const type = typeof s.Type === "string" ? sanitizeServerText(s.Type) : undefined;
    const content = typeof s.Content === "string" ? sanitizeServerText(s.Content) : undefined;
    throw new DestatisApiError({
      method: "POST",
      url: redactUrl(url),
      body: text,
      ...(code !== undefined ? { code } : {}),
      ...(type !== undefined ? { statusType: type } : {}),
      detail: `${content ? `${content} — ` : ""}the server sent this status instead of a file`,
    });
  }

  private decodeJson<T>(method: "GET" | "POST", path: string, res: RawResponse): T {
    const text = res.data.toString("utf8");
    if (res.status === 204 || text.trim().length === 0) {
      return null as T;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new DestatisParseError(`Failed to parse JSON response from ${path}`, { cause });
    }
    this.checkLogicalStatus(method, this.buildUrl(path), text, parsed);
    return parsed as T;
  }

  /**
   * Inspect a parsed GENESIS body for a logical error. GENESIS answers HTTP 200
   * even when a request logically failed. The outcome arrives in one of TWO
   * shapes:
   *
   *  - the usual envelope with a `Status` object (`{ Code, Content, Type }`), or
   *  - a **flat** top-level `{ Code, Content, Type }` object with no envelope at
   *    all — the authentication-failure shape (Code 15 when no credentials were
   *    sent, Code 2 for wrong credentials). The live server pairs those with
   *    HTTP 401/404 (handled in toApiError); the flat mapping here is kept as a
   *    defensive path should they ever arrive on a 2xx.
   *
   * Throws for "object not found" (90), "too large" (98), and any error `Type`
   * (which covers the flat auth errors); returns quietly for success/warning
   * codes and for the "empty result" code (104), which is a valid outcome the
   * caller renders as an empty list.
   */
  private checkLogicalStatus(
    method: "GET" | "POST",
    url: string,
    body: string,
    parsed: unknown,
  ): void {
    const s = genesisStatus(parsed);
    if (s === undefined) return;
    const code = typeof s.Code === "number" ? s.Code : undefined;
    if (code === undefined || code === CODE_EMPTY) return;

    // Type / Content are server-controlled and reach the terminal via the error
    // message; strip any embedded terminal control characters at the source.
    const type = typeof s.Type === "string" ? sanitizeServerText(s.Type) : undefined;
    const content = typeof s.Content === "string" ? sanitizeServerText(s.Content) : undefined;
    const isErrorType = type !== undefined && /error|fehler/i.test(type);

    if (code === CODE_NOT_FOUND || code === CODE_TOO_LARGE || isErrorType) {
      const detail =
        code === CODE_TOO_LARGE
          ? `${content ?? "result too large"} — this read-only CLI does not run the async batch-job flow; narrow the selection (--start-year/--end-year/--timeslices/--class-key) or download a smaller subset`
          : content;
      throw new DestatisApiError({
        method,
        url: redactUrl(url),
        body,
        code,
        statusType: type,
        detail,
      });
    }
  }

  /**
   * Map a non-2xx reply to a typed error. The live server pairs auth failures
   * with a GENESIS status JSON body (HTTP 401 + flat `{ Code: 15, ... }` for
   * missing credentials, HTTP 404 + flat `{ Code: 2, ... }` for wrong ones), so
   * the body is inspected for a GENESIS status — enveloped or flat — and its
   * Code/Type/Content are carried onto the error. That keeps a 404-for-bad-
   * credentials from masquerading as "object not found" (see errors.ts).
   */
  private toApiError(
    method: "GET" | "POST",
    url: string,
    status: number,
    body: Buffer,
  ): DestatisApiError {
    const text = body.toString("utf8");
    let detail: string | undefined;
    let code: number | undefined;
    let statusType: string | undefined;
    if (status >= 300 && status < 400) {
      detail = "unexpected redirect — use the canonical host (default https://genesis.destatis.de)";
    } else {
      try {
        const parsed = JSON.parse(text) as unknown;
        const s = genesisStatus(parsed);
        if (s) {
          if (typeof s.Code === "number") code = s.Code;
          if (typeof s.Type === "string") statusType = s.Type;
          if (typeof s.Content === "string") detail = s.Content;
        } else if (parsed && typeof parsed === "object") {
          const d = (parsed as { detail?: unknown }).detail;
          if (typeof d === "string") detail = d;
        }
      } catch {
        // Not JSON. Surface a short, whitespace-collapsed snippet of a textual
        // body (e.g. GENESIS' plain-text 500 "…pDirectory is null") so the
        // failure isn't context-free. Skip HTML/XML error pages (start with "<"),
        // which are noise to a CLI user. The `\s+` collapse leaves ESC/C0 controls
        // intact, so sanitize below.
        const snippet = text.trim().replace(/\s+/g, " ");
        if (snippet.length > 0 && !snippet.startsWith("<")) {
          detail = snippet.length > 200 ? `${snippet.slice(0, 200)}…` : snippet;
        }
      }
      // All branches take server-controlled text; strip terminal control chars
      // before it reaches stderr.
      if (detail !== undefined) detail = sanitizeServerText(detail);
      if (statusType !== undefined) statusType = sanitizeServerText(statusType);
    }
    return new DestatisApiError({
      httpStatus: status,
      url: redactUrl(url),
      method,
      body: text,
      ...(code !== undefined ? { code } : {}),
      ...(statusType !== undefined ? { statusType } : {}),
      detail,
    });
  }
}
