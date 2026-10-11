// Public entry point for the API client library.

export { DestatisClient } from "./client.js";
export type { DestatisClientOptions } from "./client.js";
export {
  RequestEngine,
  DEFAULT_BASE_URL,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  cleartextProblem,
  loginVerdict,
  parseRetryAfter,
  redactUrl,
} from "./engine.js";
export type { EngineOptions, LoginVerdict, RawResponse, ResponseShape, RetryEvent } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  DestatisError,
  DestatisApiError,
  DestatisNetworkError,
  DestatisUsageError,
  DestatisValidationError,
  DestatisParseError,
  credentialsIn,
  cutForMessage,
  MAX_MESSAGE_VALUE_LENGTH,
  redactCredentials,
  redactSecrets,
} from "./errors.js";
export {
  assertRequestParams,
  assertValid,
  BASE_URL_USERINFO_PROBLEM,
  baseUrlProblem,
  accessModeProblem,
  CREDENTIAL_PAIR_PROBLEM,
  credentialPairProblem,
  GUEST_WITH_CREDENTIALS_PROBLEM,
  NO_CREDENTIALS_PROBLEM,
  TOKEN_WITH_LOGIN_PROBLEM,
  tokenOrLoginProblem,
  credentialProblem,
  headerNameProblem,
  headerValueProblem,
  intRangeProblem,
  looksLikeToken,
  nonBlankProblem,
  oneOfProblem,
  plainObjectProblem,
  functionProblem,
} from "./validate.js";
export type { Problem } from "./validate.js";

export * from "./params.js";
export * from "./types.js";
