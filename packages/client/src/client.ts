// DestatisClient — a typed client over the DESTATIS GENESIS-Online REST API
// (https://genesis.destatis.de/genesisWS/rest/2020), the German Federal
// Statistical Office's official-statistics database.
//
// Auth: GENESIS has no Bearer/X-API-Key header. Authenticated calls are POST with
// the credentials in HTTP header fields — EITHER a 32-char personal API token in
// the `username` header (no password) OR a `username`+`password` pair — and the
// request parameters in a form-urlencoded body. No credential is bundled; pass
// them via the options below (CLI: --token / --username+--password, or the
// DESTATIS_API_TOKEN / DESTATIS_USERNAME / DESTATIS_PASSWORD env vars).
// Running without an account is explicit: `guest: true` (CLI: --guest) — a client
// with neither credentials nor `guest: true` throws `DestatisValidationError` at
// construction, never falling back to guest access. As guest, `whoami()` and
// `find()` work (GENESIS answers an anonymous search as the guest user "GAST");
// catalogue, metadata, data and `logincheck()` need an account, and reject with
// `DestatisValidationError` before any request when the client has none.
//
//   const c = new DestatisClient({ token: process.env.DESTATIS_API_TOKEN });
//   const guest = new DestatisClient({ guest: true });
//   await c.find({ term: "Bevölkerung" });
//   await c.data.table("12411-0001", { startyear: "2020" });

import { RequestEngine, type EngineOptions, type RawResponse, type ResponseShape } from "./engine.js";
import type { QueryParams } from "./query.js";
import {
  accessModeProblem,
  assertRequestParams,
  assertValid,
  credentialPairProblem,
  credentialProblem,
  credentialsRequiredProblem,
  nonBlankProblem,
  plainObjectProblem,
  tokenOrLoginProblem,
} from "./validate.js";
import {
  CATALOGUE_PARAM_KEYS,
  DATA_FILE_PARAM_KEYS,
  DATA_PARAM_KEYS,
  FIND_PARAM_KEYS,
  METADATA_PARAM_KEYS,
  type CatalogueParams,
  type DataFileParams,
  type DataTableParams,
  type FindParams,
  type Language,
  type MetadataParams,
  type ParamOptions,
} from "./params.js";
import type {
  CatalogueResponse,
  CubeItem,
  DataResponse,
  FindResponse,
  JobItem,
  LoginCheckResponse,
  MetadataResponse,
  ModifiedDataItem,
  StatisticItem,
  TableItem,
  VariableItem,
  WhoamiResponse,
} from "./types.js";

const API = "/genesisWS/rest/2020";

/** Accept header for the file-download endpoints (GENESIS returns a ZIP wrapper). */
const FILE_ACCEPT = "application/zip, */*";

/** A supplier of the per-request credential headers (username / optional password). */
type AuthHeaders = () => Record<string, string>;

/**
 * Validate a request's parameters (see `validate.ts`) and POST them, parsing the
 * JSON reply. `async`, so a rejected input rejects the promise — and sends nothing.
 */
async function postJson<T>(
  e: RequestEngine,
  path: string,
  params: QueryParams,
  auth: AuthHeaders,
  shape: ResponseShape = "envelope",
): Promise<T> {
  assertRequestParams(params);
  return e.postJson<T>(path, params, auth(), shape);
}

/**
 * A method's parameter object, checked: `undefined` is none, anything else must be a
 * plain object (`DestatisValidationError` otherwise — a string would be spread into
 * `0=x`, `null` into nothing), with only the endpoint's keys (`keys`, P10) unless
 * `options.allowUnknownParams`, and valid values (`assertRequestParams`).
 */
function paramsOf(params: unknown, keys: readonly string[], options: unknown = {}): QueryParams {
  assertValid("options", options, plainObjectProblem);
  if (params === undefined) return {};
  assertValid("params", params, plainObjectProblem);
  const copy = { ...(params as object) } as QueryParams;
  assertRequestParams(copy, keys, options as ParamOptions);
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === "string") copy[key] = normalizeText(value);
  }
  return copy;
}

/**
 * Text as GENESIS matches it: Unicode NFC (P11). A term typed or pasted in decomposed
 * form ("o" + U+0308, as macOS file names and some clipboards produce) looks identical
 * but matched nothing — live, `find "Bevölkerung"` decomposed answered every list
 * `null`, composed 80 tables. Nothing else is changed (no trimming: values are sent as
 * given).
 */
function normalizeText(value: string): string {
  return value.normalize("NFC");
}

/** Validate a request object's required `name` (the object code) and its parameters. */
function named(name: string, params: unknown, keys: readonly string[], options: unknown): QueryParams {
  assertValid("name", name, nonBlankProblem);
  return { name: normalizeText(name), ...paramsOf(params, keys, options) } as QueryParams;
}

/** Options for the GENESIS client (engine options plus credentials). */
export interface DestatisClientOptions extends EngineOptions {
  /**
   * A 32-char personal API token. Sent in the `username` header field with no
   * password. Not together with `username`/`password`: a token next to either is a
   * `DestatisValidationError` (`TOKEN_WITH_LOGIN_PROBLEM`), never a silent pick.
   */
  token?: string;
  /**
   * Account username (10 chars, may be an email). Requires `password`: with only
   * one of the two (and no token) the constructor throws `DestatisValidationError`.
   */
  username?: string;
  /** Account password (10–50 chars). */
  password?: string;
  /**
   * Run without an account, as the GENESIS guest user: `whoami()` and `find()` only.
   * Must be set explicitly when no credential is given — a client with neither
   * throws `DestatisValidationError` — and must not be combined with one.
   */
  guest?: boolean;
}

/** `catalogue/*` browse endpoints — each returns an enveloped `List`. */
class CatalogueGroup {
  constructor(
    private readonly e: RequestEngine,
    private readonly auth: AuthHeaders,
  ) {}

  private async list<TItem>(method: string, params: CatalogueParams, options: ParamOptions): Promise<CatalogueResponse<TItem>> {
    return postJson(this.e, `${API}/catalogue/${method}`, paramsOf(params, CATALOGUE_PARAM_KEYS, options), this.auth);
  }

  tables(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("tables", params, options);
  }
  statistics(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<StatisticItem>> {
    return this.list("statistics", params, options);
  }
  cubes(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<CubeItem>> {
    return this.list("cubes", params, options);
  }
  timeseries(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<CubeItem>> {
    return this.list("timeseries", params, options);
  }
  variables(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<VariableItem>> {
    return this.list("variables", params, options);
  }
  values(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<VariableItem>> {
    return this.list("values", params, options);
  }
  terms(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("terms", params, options);
  }
  jobs(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<JobItem>> {
    return this.list("jobs", params, options);
  }
  modifiedData(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<ModifiedDataItem>> {
    return this.list("modifieddata", params, options);
  }
  results(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("results", params, options);
  }
  qualitySigns(params: CatalogueParams = {}, options: ParamOptions = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("qualitysigns", params, options);
  }
}

/** `metadata/*` describe endpoints — each returns a single opaque `Object`. */
class MetadataGroup {
  constructor(
    private readonly e: RequestEngine,
    private readonly auth: AuthHeaders,
  ) {}

  private async get(method: string, name: string, params: MetadataParams, options: ParamOptions): Promise<MetadataResponse> {
    return postJson(this.e, `${API}/metadata/${method}`, named(name, params, METADATA_PARAM_KEYS, options), this.auth);
  }

  table(name: string, params: MetadataParams = {}, options: ParamOptions = {}): Promise<MetadataResponse> {
    return this.get("table", name, params, options);
  }
  statistic(name: string, params: MetadataParams = {}, options: ParamOptions = {}): Promise<MetadataResponse> {
    return this.get("statistic", name, params, options);
  }
  cube(name: string, params: MetadataParams = {}, options: ParamOptions = {}): Promise<MetadataResponse> {
    return this.get("cube", name, params, options);
  }
  timeseries(name: string, params: MetadataParams = {}, options: ParamOptions = {}): Promise<MetadataResponse> {
    return this.get("timeseries", name, params, options);
  }
  variable(name: string, params: MetadataParams = {}, options: ParamOptions = {}): Promise<MetadataResponse> {
    return this.get("variable", name, params, options);
  }
  value(name: string, params: MetadataParams = {}, options: ParamOptions = {}): Promise<MetadataResponse> {
    return this.get("value", name, params, options);
  }
}

/** `data/*` endpoints — statistical data as JSON-embedded CSV, or file downloads. */
class DataGroup {
  constructor(
    private readonly e: RequestEngine,
    private readonly auth: AuthHeaders,
  ) {}

  private async json(method: string, name: string, params: DataTableParams, options: ParamOptions): Promise<DataResponse> {
    return postJson(this.e, `${API}/data/${method}`, named(name, params, DATA_PARAM_KEYS, options), this.auth);
  }

  table(name: string, params: DataTableParams = {}, options: ParamOptions = {}): Promise<DataResponse> {
    return this.json("table", name, params, options);
  }
  cube(name: string, params: DataTableParams = {}, options: ParamOptions = {}): Promise<DataResponse> {
    return this.json("cube", name, params, options);
  }
  timeseries(name: string, params: DataTableParams = {}, options: ParamOptions = {}): Promise<DataResponse> {
    return this.json("timeseries", name, params, options);
  }
  result(name: string, params: DataTableParams = {}, options: ParamOptions = {}): Promise<DataResponse> {
    return this.json("result", name, params, options);
  }

  private async file(method: string, name: string, params: DataFileParams, options: ParamOptions): Promise<RawResponse> {
    const all = named(name, params, DATA_FILE_PARAM_KEYS, options);
    assertRequestParams(all);
    return this.e.postRaw(`${API}/data/${method}`, FILE_ACCEPT, all, this.auth());
  }
  tableFile(name: string, params: DataFileParams = {}, options: ParamOptions = {}): Promise<RawResponse> {
    return this.file("tablefile", name, params, options);
  }
  cubeFile(name: string, params: DataFileParams = {}, options: ParamOptions = {}): Promise<RawResponse> {
    return this.file("cubefile", name, params, options);
  }
  timeseriesFile(name: string, params: DataFileParams = {}, options: ParamOptions = {}): Promise<RawResponse> {
    return this.file("timeseriesfile", name, params, options);
  }
  resultFile(name: string, params: DataFileParams = {}, options: ParamOptions = {}): Promise<RawResponse> {
    return this.file("resultfile", name, params, options);
  }
}

export class DestatisClient {
  private readonly engine: RequestEngine;
  // Real private fields (not TypeScript's `private`): util.inspect, console.log and
  // JSON.stringify of a client never show them, so logging a client can't reveal the
  // token or password.
  readonly #username: string | undefined;
  readonly #password: string | undefined;

  readonly catalogue: CatalogueGroup;
  readonly metadata: MetadataGroup;
  readonly data: DataGroup;

  constructor(options: DestatisClientOptions = {}) {
    assertValid("options", options, plainObjectProblem);
    const { token, username, password, guest, ...engineOptions } = options;
    // Token mode collapses onto the `username` field with no password; otherwise
    // use the username/password pair. Blank (empty or whitespace-only) values are
    // treated as unset (an empty `token: process.env.DESTATIS_API_TOKEN` counts as no
    // token — and with no other credential and no `guest: true` that is an error, not
    // guest access); any other value must be a valid credential header value
    // (`credentialProblem`: no control characters, nothing above U+00FF, no
    // surrounding whitespace) and is sent exactly as given, never trimmed.
    // A non-string (a JavaScript caller's number or null) is a DestatisValidationError,
    // not a raw TypeError from `.trim()`.
    const set = (name: string, v: unknown): string | undefined =>
      v === undefined || (typeof v === "string" && v.trim() === "") ? undefined : assertValid(name, v as string, credentialProblem);
    const tok = set("token", token);
    const user = set("username", username);
    const pass = set("password", password);
    // One access mode, chosen explicitly (no silent guest): credentials or guest: true.
    assertValid("credentials", { hasCredentials: [tok, user, pass].some((v) => v !== undefined), guest }, accessModeProblem);
    // One login: a token or a username and password, never both (no silent winner).
    assertValid("credentials", { token: tok, username: user, password: pass }, tokenOrLoginProblem);
    if (tok) {
      this.#username = tok;
      this.#password = undefined;
    } else {
      this.#username = user;
      this.#password = pass;
      assertValid("credentials", { username: this.#username, password: this.#password }, credentialPairProblem);
    }
    this.engine = new RequestEngine(engineOptions);

    // catalogue, metadata and data are account-only endpoints.
    const auth: AuthHeaders = () => this.requireAuth();
    this.catalogue = new CatalogueGroup(this.engine, auth);
    this.metadata = new MetadataGroup(this.engine, auth);
    this.data = new DataGroup(this.engine, auth);
  }

  /**
   * The credential headers for an account-only endpoint. Without credentials
   * GENESIS would answer 401 + Code 15 after the round trip, so this throws
   * `DestatisValidationError` (`Invalid credentials: …`) before any request.
   */
  private requireAuth(): Record<string, string> {
    assertValid("credentials", { username: this.#username }, credentialsRequiredProblem);
    return this.authHeaders();
  }

  /** The credential headers merged into every request that takes them (none when unset). */
  private authHeaders(): Record<string, string> {
    if (!this.#username) return {};
    return this.#password
      ? { username: this.#username, password: this.#password }
      : { username: this.#username };
  }

  /** `helloworld/whoami` — connectivity check; unauthenticated GET. */
  whoami(): Promise<WhoamiResponse> {
    return this.engine.getJson(`${API}/helloworld/whoami`);
  }

  /**
   * `helloworld/logincheck` — validate the supplied credentials. Resolves only when
   * GENESIS confirms the login. Wrong credentials — which GENESIS answers with HTTP 200
   * and an error text in `Status` — reject with a `DestatisApiError` whose `isAuthError`
   * (and `loginRejected`) is true; an answer that is neither an explicit success nor an
   * explicit failure rejects with `DestatisParseError`. Rejects with
   * `DestatisValidationError` for a guest client (there is nothing to check).
   */
  async logincheck(language?: Language): Promise<LoginCheckResponse> {
    const params: QueryParams = { language };
    assertRequestParams(params);
    return this.engine.postLoginCheck(`${API}/helloworld/logincheck`, params, this.requireAuth());
  }

  /**
   * `find/find` — full-text search across object types. `term` must be non-blank; only
   * the `FindParams` keys are accepted unless `options.allowUnknownParams` (P10).
   */
  async find(params: FindParams, options: ParamOptions = {}): Promise<FindResponse> {
    assertValid("params", params, plainObjectProblem);
    assertValid("term", params.term, nonBlankProblem);
    return postJson(this.engine, `${API}/find/find`, paramsOf(params, FIND_PARAM_KEYS, options), () => this.authHeaders());
  }
}
