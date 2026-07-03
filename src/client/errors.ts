// Error types raised by the client. Kept free of any I/O so they are trivial to
// construct in tests and to `instanceof`-check by consumers.

/** Base class for every error originating from this client. */
export class DestatisError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The API signalled a failure. GENESIS-Online is unusual: it answers HTTP 200 for
 * most *logical* errors and carries the real outcome in a `Status` object in the
 * body (see engine.ts). This error therefore models both worlds:
 *
 *  - `httpStatus` is set for genuine transport/HTTP failures (non-2xx, e.g. a
 *    gateway 502 or an auth-layer 401);
 *  - `code` is set for a GENESIS logical error, taken from `Status.Code`
 *    (e.g. 90 = object not found, 98 = table too large), with `statusType` the
 *    `Status.Type` ("Fehler"/"Error").
 *
 * At least one of the two is always present; `detail` holds the human-readable
 * message (`Status.Content`, or a parsed field from an HTTP error body).
 */
export class DestatisApiError extends DestatisError {
  readonly httpStatus: number | undefined;
  readonly code: number | undefined;
  readonly statusType: string | undefined;
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly detail: string | undefined;

  constructor(args: {
    url: string;
    method: string;
    body: string;
    httpStatus?: number;
    code?: number;
    statusType?: string;
    detail?: string;
  }) {
    const detailPart = args.detail ? `: ${args.detail}` : "";
    const head =
      args.code !== undefined
        ? `GENESIS status ${args.code}${args.statusType ? ` (${args.statusType})` : ""}`
        : `HTTP ${args.httpStatus ?? 0}`;
    super(`${head} for ${args.method} ${args.url}${detailPart}`);
    this.httpStatus = args.httpStatus;
    this.code = args.code;
    this.statusType = args.statusType;
    this.url = args.url;
    this.method = args.method;
    this.body = args.body;
    this.detail = args.detail;
  }

  /**
   * True when the API signalled "no such object": the GENESIS logical code 90
   * (requested object not found) or a transport-level HTTP 404. Lets the CLI map
   * a miss to a distinct exit code for scripting.
   */
  get isNotFound(): boolean {
    return this.code === 90 || this.httpStatus === 404;
  }

  /** True for HTTP statuses the engine treats as transient and retries. */
  get isRetryable(): boolean {
    return this.httpStatus === 429 || this.httpStatus === 503;
  }
}

/** A transport-level failure (DNS, connection reset, timeout, ...). */
export class DestatisNetworkError extends DestatisError {}

/**
 * A CLI usage error (bad/missing argument or credentials detected before any
 * request, e.g. only one of --username/--password, or a credential-required
 * command invoked with none). Mapped to the conventional usage exit code 2 so
 * scripts can distinguish it from a runtime error (1).
 */
export class DestatisUsageError extends DestatisError {}

/** The response body could not be parsed as the expected JSON shape. */
export class DestatisParseError extends DestatisError {}
