/**
 * nycrentals core: a forwarding client for the hosted Borough
 * MCP endpoint, with local validation.
 *
 * tools/list is served locally from the literal tool
 * definitions below. A tools/call is checked locally first —
 * API-key gate, argument types, required arguments, then the
 * documented exclusivity and flag rules, in that order — and
 * only then forwarded over a Streamable HTTP session:
 * an initialize POST that captures the mcp-session-id
 * response header, a notifications/initialized POST, then
 * the tools/call POST carrying the session header. The
 * session is established once and reused for the lifetime of
 * the client. The upstream result's content is returned
 * unchanged and an upstream isError is propagated.
 */
import type { BoroughDeps, FetchFn, FetchResponseLike, ToolArgs, ToolResult } from "./types.js";

export const VERSION = "0.1.0";

export const UPSTREAM_URL = "https://borough.qwady.app/mcp";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals)                              */
/* ------------------------------------------------------------------ */

const STRING_OR_ARRAY = (description: string) => ({
  anyOf: [{ type: "string" }, { items: { type: "string" }, type: "array" }],
  description,
});

const AMENITIES_PROP = STRING_OR_ARRAY(
  "Amenity enums such as DISHWASHER, WASHER_DRYER, ELEVATOR, DOORMAN, LAUNDRY, GYM, POOL, PARKING.",
);
const AREAS_PROP = STRING_OR_ARRAY(
  "Area IDs (comma-separated string or array, at most 10). Borough IDs: Manhattan=100, Bronx=200, Brooklyn=300, Queens=400, Staten Island=500.",
);
const LOCATIONS_PROP = STRING_OR_ARRAY("Borough or neighborhood names.");
const BUILDING_TYPE_PROP = {
  description:
    "Comma-separated: RENTAL, CONDO, CO_OP, CONDOP, HOUSE, SINGLEFAMILY, TOWNHOUSE, TWOFAMILY, THREEFAMILY, FOURFAMILY, MULTI_FAMILY, MIXED_USE, HYBRID, COMMERCIAL, UNKNOWN.",
  type: "string",
};
const SORT_PROP = {
  description: "Sort field.",
  enum: ["PRICE", "LISTED_AT", "RECOMMENDED"],
  type: "string",
};
const SORT_DIR_PROP = {
  description: "Sort direction.",
  enum: ["ASC", "DESC"],
  type: "string",
};
const LISTING_TYPE_PROP = { description: "Listing type.", enum: ["rental", "sale"], type: "string" };

function searchProperties(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    amenities: AMENITIES_PROP,
    areas: AREAS_PROP,
    buildingType: BUILDING_TYPE_PROP,
    fiberOnly: { description: "Only fiber-internet buildings.", type: "boolean" },
    has3dTour: {
      description: "Only listings with a 3D tour. Accepts true or must be omitted.",
      type: "boolean",
    },
    hasOpenHouse: {
      description: "Only listings with an open house. Accepts true or must be omitted.",
      type: "boolean",
    },
    location: { description: "A single borough or neighborhood name.", type: "string" },
    locations: LOCATIONS_PROP,
    maxBaths: { description: "Maximum bathrooms, 1-4.", type: "integer" },
    maxBeds: { description: "Maximum bedrooms, 0-50.", type: "integer" },
    maxMonthlyCost: { description: "Maximum total monthly cost.", type: "number" },
    maxPrice: { description: "Maximum price.", type: "number" },
    maxSqft: { description: "Maximum square footage.", type: "number" },
    minBaths: { description: "Minimum bathrooms, 1-4.", type: "integer" },
    minBeds: { description: "Minimum bedrooms, 0-50; 0 = studio.", type: "integer" },
    minDownloadMbps: { description: "Minimum download speed in Mbps.", type: "number" },
    minPrice: { description: "Minimum price.", type: "number" },
    minSqft: { description: "Minimum square footage.", type: "number" },
    minTransitScore: { description: "Minimum transit score, 0-100.", type: "number" },
    ...extra,
    page: { description: "Page number; defaults to 1 upstream.", type: "number" },
    perPage: { description: "Results per page; default 3, max 5 upstream.", type: "number" },
    petsAllowed: { description: "Only pet-friendly listings.", type: "boolean" },
    sort: SORT_PROP,
    sortDir: SORT_DIR_PROP,
  };
}

const MARKET_PROPERTIES = {
  areaId: { description: "The area ID.", type: "number" },
  bedrooms: { description: "Bedroom count, 0-6.", type: "number" },
  listingType: {
    description: "Listing type; defaults to rental upstream.",
    enum: ["rental", "sale"],
    type: "string",
  },
  location: { description: "A neighborhood name.", type: "string" },
};

export const TOOL_DEFS = [
  {
    name: "search_rentals",
    description: "Search active rental listings across all five NYC boroughs.",
    inputSchema: {
      type: "object" as const,
      properties: searchProperties({
        noFee: {
          description: "Only no-fee rentals. Accepts true or must be omitted.",
          type: "boolean",
        },
      }),
    },
  },
  {
    name: "search_sales",
    description: "Search active for-sale listings.",
    inputSchema: {
      type: "object" as const,
      properties: searchProperties({
        saleType: {
          description: "Sale type.",
          enum: ["RESALE", "SPONSOR_UNIT", "FORECLOSURE", "RESTRICTED", "AUCTION", "SHORT", "UNKNOWN"],
          type: "string",
        },
      }),
    },
  },
  {
    name: "get_property",
    description:
      "Get listing detail for a specific ID (price, address, beds/baths, sqft, listing amenities, pet policy, and building scores), returned as a compact projection for chat clients.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { description: "The listing ID.", type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_property_by_url",
    description: "Look up a listing by its URL path.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          description: "A URL path such as /sale/<id> or /building/<slug>/<unit>.",
          type: "string",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_building",
    description: "Get detailed building information.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { description: "The building ID.", type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_building_listings",
    description: "Get the listings Borough has linked to a specific building, cheapest first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { description: "The building ID.", type: "string" },
        listingType: LISTING_TYPE_PROP,
        page: { description: "Page number.", type: "number" },
        perPage: { description: "Results per page.", type: "number" },
        status: {
          description: "Listing status.",
          enum: ["ACTIVE", "IN_CONTRACT", "OFF_MARKET"],
          type: "string",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_areas",
    description:
      "List Borough's areas: 316 NYC neighborhoods and sub-areas, the five boroughs, and Northern New Jersey coverage. Results are paginated.",
    inputSchema: {
      type: "object" as const,
      properties: {
        level: {
          description:
            "0 = top container, 1 = borough or region, 2-5 = groupings, neighborhoods, sub-neighborhoods.",
          type: "number",
        },
        page: { description: "Page number.", type: "number" },
        parentId: { description: "Parent area ID.", type: "number" },
        perPage: { description: "Results per page; default 10, max 25 upstream.", type: "number" },
        q: { description: "Name lookup.", type: "string" },
      },
    },
  },
  {
    name: "get_market_snapshot",
    description: "Current market statistics for a neighborhood.",
    inputSchema: { type: "object" as const, properties: MARKET_PROPERTIES },
  },
  {
    name: "get_market_trends",
    description:
      "Recent price trends for a neighborhood: up to 365 rows, one per date and event type, most recent first.",
    inputSchema: { type: "object" as const, properties: MARKET_PROPERTIES },
  },
  {
    name: "compare_neighborhoods",
    description: "Side-by-side comparison of 1-5 neighborhoods.",
    inputSchema: {
      type: "object" as const,
      properties: {
        areas: STRING_OR_ARRAY("Area IDs; exactly one of areas / locations, holding 1-5 entries."),
        bedrooms: { description: "Bedroom count, 0-6.", type: "number" },
        listingType: LISTING_TYPE_PROP,
        locations: STRING_OR_ARRAY(
          "Neighborhood names; exactly one of areas / locations, holding 1-5 entries.",
        ),
      },
    },
  },
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/* ------------------------------------------------------------------ */
/* Local validation                                                    */
/* ------------------------------------------------------------------ */

type ParamKind = "string" | "number" | "integer" | "boolean" | "stringOrArray";

interface ParamSpec {
  kind: ParamKind;
  enum?: readonly string[];
}

const S = (kind: ParamKind, enumValues?: readonly string[]): ParamSpec =>
  enumValues ? { kind, enum: enumValues } : { kind };

const SEARCH_PARAM_SPECS: Record<string, ParamSpec> = {
  amenities: S("stringOrArray"),
  areas: S("stringOrArray"),
  buildingType: S("string"),
  fiberOnly: S("boolean"),
  has3dTour: S("boolean"),
  hasOpenHouse: S("boolean"),
  location: S("string"),
  locations: S("stringOrArray"),
  maxBaths: S("integer"),
  maxBeds: S("integer"),
  maxMonthlyCost: S("number"),
  maxPrice: S("number"),
  maxSqft: S("number"),
  minBaths: S("integer"),
  minBeds: S("integer"),
  minDownloadMbps: S("number"),
  minPrice: S("number"),
  minSqft: S("number"),
  minTransitScore: S("number"),
  page: S("number"),
  perPage: S("number"),
  petsAllowed: S("boolean"),
  sort: S("string", ["PRICE", "LISTED_AT", "RECOMMENDED"]),
  sortDir: S("string", ["ASC", "DESC"]),
};

const PARAM_SPECS: Record<string, Record<string, ParamSpec>> = {
  search_rentals: { ...SEARCH_PARAM_SPECS, noFee: S("boolean") },
  search_sales: {
    ...SEARCH_PARAM_SPECS,
    noFee: S("boolean"),
    saleType: S("string", ["RESALE", "SPONSOR_UNIT", "FORECLOSURE", "RESTRICTED", "AUCTION", "SHORT", "UNKNOWN"]),
  },
  get_property: { id: S("string") },
  get_property_by_url: { url: S("string") },
  get_building: { id: S("string") },
  get_building_listings: {
    id: S("string"),
    listingType: S("string", ["rental", "sale"]),
    page: S("number"),
    perPage: S("number"),
    status: S("string", ["ACTIVE", "IN_CONTRACT", "OFF_MARKET"]),
  },
  list_areas: {
    level: S("number"),
    page: S("number"),
    parentId: S("number"),
    perPage: S("number"),
    q: S("string"),
  },
  get_market_snapshot: {
    areaId: S("number"),
    bedrooms: S("number"),
    listingType: S("string", ["rental", "sale"]),
    location: S("string"),
  },
  get_market_trends: {
    areaId: S("number"),
    bedrooms: S("number"),
    listingType: S("string", ["rental", "sale"]),
    location: S("string"),
  },
  compare_neighborhoods: {
    areas: S("stringOrArray"),
    bedrooms: S("number"),
    listingType: S("string", ["rental", "sale"]),
    locations: S("stringOrArray"),
  },
};

const REQUIRED_PARAMS: Record<string, string[]> = {
  get_property: ["id"],
  get_property_by_url: ["url"],
  get_building: ["id"],
  get_building_listings: ["id"],
};

/** Flags that accept true or absence only, in check order. */
const TRUE_ONLY_FLAGS = ["noFee", "hasOpenHouse", "has3dTour"] as const;

function typeOk(value: unknown, spec: ParamSpec): boolean {
  switch (spec.kind) {
    case "string":
      return typeof value === "string" && (spec.enum === undefined || spec.enum.includes(value));
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "stringOrArray":
      return (
        typeof value === "string" ||
        (Array.isArray(value) && value.every((v) => typeof v === "string"))
      );
  }
}

/** Entries in an areas/locations value: array length, or comma-split count for a string. */
export function countEntries(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    if (value.trim() === "") return 0;
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0).length;
  }
  return 0;
}

/**
 * Validate a tool's arguments locally, in the documented
 * order. Returns the pinned error text, or null when the
 * arguments may be forwarded.
 */
export function validateArgs(tool: string, args: ToolArgs): string | null {
  const specs = PARAM_SPECS[tool] ?? {};

  // 1. Wrong-typed arguments.
  for (const name of Object.keys(specs).sort()) {
    const value = args[name];
    if (value !== undefined && !typeOk(value, specs[name])) {
      return `${tool}: argument ${name} has the wrong type`;
    }
  }

  // 2. Missing required arguments.
  for (const name of REQUIRED_PARAMS[tool] ?? []) {
    if (args[name] === undefined) return `${tool}: missing required argument: ${name}`;
  }

  const isSearch = tool === "search_rentals" || tool === "search_sales";

  // 3. Search tools: at most one of areas / location / locations.
  if (isSearch) {
    const present = ["areas", "location", "locations"].filter((n) => args[n] !== undefined);
    if (present.length > 1) {
      return "use either areas, location, or locations, not more than one";
    }
  }

  // 4. True-only flags reject an explicit false.
  if (isSearch) {
    for (const name of TRUE_ONLY_FLAGS) {
      if (args[name] === false) return `${name} accepts true or must be omitted`;
    }
  }

  // 5. Sale search never accepts noFee.
  if (tool === "search_sales" && args.noFee !== undefined) {
    return "noFee is not accepted for sale search: a broker fee is something you pay to rent";
  }

  // 6. compare_neighborhoods: exactly one list, holding 1-5 entries.
  if (tool === "compare_neighborhoods") {
    const hasAreas = args.areas !== undefined;
    const hasLocations = args.locations !== undefined;
    if (hasAreas === hasLocations) return "use either areas or locations, not both";
    const count = countEntries(hasAreas ? args.areas : args.locations);
    if (count < 1 || count > 5) return "compare_neighborhoods compares 1-5 neighborhoods";
  }

  // 7. Search tools: areas holds at most 10 entries.
  if (isSearch && args.areas !== undefined && countEntries(args.areas) > 10) {
    return "areas accepts at most 10 area IDs per call";
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/** Parse a JSON-RPC response body, tolerating SSE framing. */
function parseRpcBody(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  let payload = trimmed;
  if (trimmed.includes("data:")) {
    const dataLines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line !== "" && line !== "[DONE]");
    if (dataLines.length > 0) payload = dataLines[dataLines.length - 1];
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function defaultFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded call
 * and reused for the lifetime of the client (the process
 * lifetime when the client is the MCP server's or the CLI's
 * single-call client).
 */
export class BoroughClient {
  private readonly deps: BoroughDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: BoroughDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(body: unknown, key: string, withSession: boolean): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (withSession && this.sessionId !== null) headers["mcp-session-id"] = this.sessionId;
    try {
      return await this.fetchFn()(UPSTREAM_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("upstream unreachable: borough-mcp");
    }
  }

  private async ensureSession(key: string): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: this.nextId(),
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "nycrentals", version: VERSION },
            },
          },
          key,
          false,
        );
        if (!initRes.ok) {
          throw new Error(`upstream error: HTTP ${initRes.status} from borough-mcp`);
        }
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initParsed = parseRpcBody(await initRes.text());
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          key,
          true,
        );
        if (!initializedRes.ok) {
          throw new Error(`upstream error: HTTP ${initializedRes.status} from borough-mcp`);
        }
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Validate, then forward one tool call; spec'd failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    const env = this.deps.env ?? process.env;
    const key = env.BOROUGH_API_KEY;
    if (!key) return errorResult("BOROUGH_API_KEY is not set");

    const validationError = validateArgs(name, args);
    if (validationError !== null) return errorResult(validationError);

    try {
      await this.ensureSession(key);
    } catch (err) {
      return errorResult(errorMessage(err));
    }

    let res: FetchResponseLike;
    try {
      res = await this.post(
        {
          jsonrpc: "2.0",
          id: this.nextId(),
          method: "tools/call",
          params: { name, arguments: args },
        },
        key,
        true,
      );
    } catch (err) {
      return errorResult(errorMessage(err));
    }
    if (!res.ok) return errorResult(`upstream error: HTTP ${res.status} from borough-mcp`);

    const parsed = parseRpcBody(await res.text());
    if (parsed !== null && parsed.error) return errorResult(rpcErrorMessage(parsed.error));
    const result = parsed?.result as { content?: unknown; isError?: boolean } | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("upstream error: invalid response from borough-mcp");
    }
    return result.isError
      ? { content: result.content, isError: true }
      : { content: result.content };
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: BoroughDeps = {}): BoroughClient {
  return new BoroughClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: BoroughDeps = {},
): Promise<ToolResult> {
  return new BoroughClient(deps).callTool(name, args);
}
