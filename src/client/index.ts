// Public entry point for the API client library.

export { DestatisClient } from "./client.js";
export type { DestatisClientOptions } from "./client.js";
export { RequestEngine, DEFAULT_BASE_URL, redactUrl } from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  DestatisError,
  DestatisApiError,
  DestatisNetworkError,
  DestatisUsageError,
  DestatisParseError,
} from "./errors.js";

export * from "./params.js";
export * from "./types.js";
