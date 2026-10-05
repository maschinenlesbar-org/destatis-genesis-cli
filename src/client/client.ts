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
// `whoami()` needs no credentials, and `find()` works without them too (GENESIS
// answers an anonymous call as the guest user "GAST"); catalogue, metadata, data
// and `logincheck()` need an account, and reject with `DestatisValidationError`
// before any request when the client has no credentials.
//
//   const c = new DestatisClient({ token: process.env.DESTATIS_API_TOKEN });
//   await c.find({ term: "Bevölkerung" });
//   await c.data.table("12411-0001", { startyear: "2020" });

import { RequestEngine, type EngineOptions, type RawResponse, type ResponseShape } from "./engine.js";
import type { QueryParams } from "./query.js";
import {
  assertRequestParams,
  assertValid,
  credentialPairProblem,
  credentialProblem,
  credentialsRequiredProblem,
  nonBlankProblem,
  plainObjectProblem,
} from "./validate.js";
import type {
  CatalogueParams,
  DataFileParams,
  DataTableParams,
  FindParams,
  Language,
  MetadataParams,
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
 * `0=x`, `null` into nothing).
 */
function paramsOf(params: unknown): QueryParams {
  if (params === undefined) return {};
  assertValid("params", params, plainObjectProblem);
  return { ...(params as object) } as QueryParams;
}

/** Validate a request object's required `name` (the object code) and its parameters. */
function named(name: string, params: unknown): QueryParams {
  assertValid("name", name, nonBlankProblem);
  return { name, ...paramsOf(params) } as QueryParams;
}

/** Options for the GENESIS client (engine options plus credentials). */
export interface DestatisClientOptions extends EngineOptions {
  /**
   * A 32-char personal API token. Sent in the `username` header field with no
   * password. Takes precedence over `username`/`password` if both are given.
   */
  token?: string;
  /**
   * Account username (10 chars, may be an email). Requires `password`: with only
   * one of the two (and no token) the constructor throws `DestatisValidationError`.
   */
  username?: string;
  /** Account password (10–50 chars). */
  password?: string;
}

/** `catalogue/*` browse endpoints — each returns an enveloped `List`. */
class CatalogueGroup {
  constructor(
    private readonly e: RequestEngine,
    private readonly auth: AuthHeaders,
  ) {}

  private async list<TItem>(method: string, params: CatalogueParams): Promise<CatalogueResponse<TItem>> {
    return postJson(this.e, `${API}/catalogue/${method}`, paramsOf(params), this.auth);
  }

  tables(params: CatalogueParams = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("tables", params);
  }
  statistics(params: CatalogueParams = {}): Promise<CatalogueResponse<StatisticItem>> {
    return this.list("statistics", params);
  }
  cubes(params: CatalogueParams = {}): Promise<CatalogueResponse<CubeItem>> {
    return this.list("cubes", params);
  }
  timeseries(params: CatalogueParams = {}): Promise<CatalogueResponse<CubeItem>> {
    return this.list("timeseries", params);
  }
  variables(params: CatalogueParams = {}): Promise<CatalogueResponse<VariableItem>> {
    return this.list("variables", params);
  }
  values(params: CatalogueParams = {}): Promise<CatalogueResponse<VariableItem>> {
    return this.list("values", params);
  }
  terms(params: CatalogueParams = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("terms", params);
  }
  jobs(params: CatalogueParams = {}): Promise<CatalogueResponse<JobItem>> {
    return this.list("jobs", params);
  }
  modifiedData(params: CatalogueParams = {}): Promise<CatalogueResponse<ModifiedDataItem>> {
    return this.list("modifieddata", params);
  }
  results(params: CatalogueParams = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("results", params);
  }
  qualitySigns(params: CatalogueParams = {}): Promise<CatalogueResponse<TableItem>> {
    return this.list("qualitysigns", params);
  }
}

/** `metadata/*` describe endpoints — each returns a single opaque `Object`. */
class MetadataGroup {
  constructor(
    private readonly e: RequestEngine,
    private readonly auth: AuthHeaders,
  ) {}

  private async get(method: string, name: string, params: MetadataParams): Promise<MetadataResponse> {
    return postJson(this.e, `${API}/metadata/${method}`, named(name, params), this.auth);
  }

  table(name: string, params: MetadataParams = {}): Promise<MetadataResponse> {
    return this.get("table", name, params);
  }
  statistic(name: string, params: MetadataParams = {}): Promise<MetadataResponse> {
    return this.get("statistic", name, params);
  }
  cube(name: string, params: MetadataParams = {}): Promise<MetadataResponse> {
    return this.get("cube", name, params);
  }
  timeseries(name: string, params: MetadataParams = {}): Promise<MetadataResponse> {
    return this.get("timeseries", name, params);
  }
  variable(name: string, params: MetadataParams = {}): Promise<MetadataResponse> {
    return this.get("variable", name, params);
  }
  value(name: string, params: MetadataParams = {}): Promise<MetadataResponse> {
    return this.get("value", name, params);
  }
}

/** `data/*` endpoints — statistical data as JSON-embedded CSV, or file downloads. */
class DataGroup {
  constructor(
    private readonly e: RequestEngine,
    private readonly auth: AuthHeaders,
  ) {}

  private async json(method: string, name: string, params: DataTableParams): Promise<DataResponse> {
    return postJson(this.e, `${API}/data/${method}`, named(name, params), this.auth);
  }

  table(name: string, params: DataTableParams = {}): Promise<DataResponse> {
    return this.json("table", name, params);
  }
  cube(name: string, params: DataTableParams = {}): Promise<DataResponse> {
    return this.json("cube", name, params);
  }
  timeseries(name: string, params: DataTableParams = {}): Promise<DataResponse> {
    return this.json("timeseries", name, params);
  }
  result(name: string, params: DataTableParams = {}): Promise<DataResponse> {
    return this.json("result", name, params);
  }

  private async file(method: string, name: string, params: DataFileParams): Promise<RawResponse> {
    const all = named(name, params);
    assertRequestParams(all);
    return this.e.postRaw(`${API}/data/${method}`, FILE_ACCEPT, all, this.auth());
  }
  tableFile(name: string, params: DataFileParams = {}): Promise<RawResponse> {
    return this.file("tablefile", name, params);
  }
  cubeFile(name: string, params: DataFileParams = {}): Promise<RawResponse> {
    return this.file("cubefile", name, params);
  }
  timeseriesFile(name: string, params: DataFileParams = {}): Promise<RawResponse> {
    return this.file("timeseriesfile", name, params);
  }
  resultFile(name: string, params: DataFileParams = {}): Promise<RawResponse> {
    return this.file("resultfile", name, params);
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
    const { token, username, password, ...engineOptions } = options;
    // Token mode collapses onto the `username` field with no password; otherwise
    // use the username/password pair. Blank (empty or whitespace-only) values are
    // treated as unset (so `token: process.env.DESTATIS_API_TOKEN` works when the
    // variable is empty); any other value must be a valid credential header value
    // (`credentialProblem`: no control characters, nothing above U+00FF, no
    // surrounding whitespace) and is sent exactly as given, never trimmed.
    // A non-string (a JavaScript caller's number or null) is a DestatisValidationError,
    // not a raw TypeError from `.trim()`.
    const set = (name: string, v: unknown): string | undefined =>
      v === undefined || (typeof v === "string" && v.trim() === "") ? undefined : assertValid(name, v as string, credentialProblem);
    const tok = set("token", token);
    if (tok) {
      this.#username = tok;
      this.#password = undefined;
    } else {
      this.#username = set("username", username);
      this.#password = set("password", password);
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
   * and an error text in `Status` (or the token echoed as `Username`) — reject with a
   * `DestatisApiError` whose `isAuthError` (and `loginRejected`) is true; an answer that
   * confirms nothing rejects with `DestatisParseError`. Rejects with
   * `DestatisValidationError` when the client has none (there is nothing to check).
   */
  async logincheck(language?: Language): Promise<LoginCheckResponse> {
    const params: QueryParams = { language };
    assertRequestParams(params);
    return this.engine.postLoginCheck(`${API}/helloworld/logincheck`, params, this.requireAuth());
  }

  /** `find/find` — full-text search across object types. `term` must be non-blank. */
  async find(params: FindParams): Promise<FindResponse> {
    assertValid("params", params, plainObjectProblem);
    assertValid("term", params.term, nonBlankProblem);
    return postJson(this.engine, `${API}/find/find`, paramsOf(params), () => this.authHeaders());
  }
}
