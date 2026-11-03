import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BoroughClient, countEntries, UPSTREAM_URL } from "../src/borough.js";
import type { FetchFn, FetchResponseLike, ToolResult } from "../src/types.js";

/**
 * Every test runs against a fake MCP upstream implementing
 * the Streamable HTTP session flow (initialize -> session
 * header -> notifications/initialized -> tools/call):
 * no live network, no live call.
 */

const KEY_ENV = { BOROUGH_API_KEY: "test-key" };
const SAMPLE_CONTENT = [{ type: "text", text: "{\"listings\":[{\"id\":\"L1\",\"price\":3200}]}" }];

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callHttpStatus?: number;
  initHttpStatus?: number;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): { fetchFn: FetchFn; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initHttpStatus !== undefined) {
        return jsonResponse(options.initHttpStatus, "upstream down");
      }
      const headers: Record<string, string> = {};
      const sessionId = options.sessionId === undefined ? "sess-123" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "borough", version: "1.2.2" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.callHttpStatus !== undefined) {
        return jsonResponse(options.callHttpStatus, "upstream down");
      }
      const result = options.callResult ?? { content: SAMPLE_CONTENT };
      return jsonResponse(200, { jsonrpc: "2.0", id: body.id, result });
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function client(options: FakeOptions = {}, env: Record<string, string | undefined> = KEY_ENV) {
  const upstream = makeUpstream(options);
  return { client: new BoroughClient({ fetchFn: upstream.fetchFn, env }), calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, initialized, then tools/call, with auth and session headers", async () => {
    const { client: c, calls } = client();
    const out = await c.callTool("search_rentals", { location: "Brooklyn", maxPrice: 3500 });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out.content, SAMPLE_CONTENT);
    assert.deepEqual(methods(calls), ["initialize", "notifications/initialized", "tools/call"]);
    assert.ok(calls.every((call) => call.url === UPSTREAM_URL));

    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, "2025-03-26");
    assert.deepEqual(initParams.clientInfo, { name: "nycrentals", version: "0.1.0" });
    assert.deepEqual(initParams.capabilities, {});
    assert.equal(calls[0].headers["mcp-session-id"], undefined);

    assert.equal(calls[1].headers["mcp-session-id"], "sess-123");
    assert.equal(calls[2].headers["mcp-session-id"], "sess-123");
    assert.ok(calls.every((call) => call.headers.Authorization === "Bearer test-key"));

    const callParams = calls[2].body.params as { name: string; arguments: unknown };
    assert.equal(callParams.name, "search_rentals");
    assert.deepEqual(callParams.arguments, { location: "Brooklyn", maxPrice: 3500 });
  });

  it("reuses the session for later calls in the same process", async () => {
    const { client: c, calls } = client();
    await c.callTool("list_areas", { level: 1 });
    await c.callTool("get_property", { id: "L1" });
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
  });
});

describe("API-key gate", () => {
  it("returns the pinned error and never fetches when the key is absent", async () => {
    const { client: c, calls } = client({}, {});
    const out = await c.callTool("list_areas", {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "BOROUGH_API_KEY is not set");
    assert.equal(calls.length, 0);
  });

  it("gates before validation", async () => {
    const { client: c, calls } = client({}, {});
    const out = await c.callTool("get_property", {});
    assert.equal(textOf(out), "BOROUGH_API_KEY is not set");
    assert.equal(calls.length, 0);
  });
});

describe("local validation: types and required arguments", () => {
  it("rejects a wrong-typed number argument with the pinned text", async () => {
    const { client: c, calls } = client();
    const out = await c.callTool("search_rentals", { minPrice: "100" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "search_rentals: argument minPrice has the wrong type");
    assert.equal(calls.length, 0);
  });

  it("rejects a non-integer value for an integer argument", async () => {
    const { client: c } = client();
    const out = await c.callTool("search_rentals", { minBeds: 1.5 });
    assert.equal(textOf(out), "search_rentals: argument minBeds has the wrong type");
  });

  it("rejects a non-string element in a string-or-array argument", async () => {
    const { client: c } = client();
    const out = await c.callTool("search_rentals", { areas: [100] });
    assert.equal(textOf(out), "search_rentals: argument areas has the wrong type");
  });

  it("rejects a wrong-typed boolean and a value outside an enum", async () => {
    const { client: c } = client();
    const boolOut = await c.callTool("search_rentals", { petsAllowed: "yes" });
    assert.equal(textOf(boolOut), "search_rentals: argument petsAllowed has the wrong type");
    const enumOut = await c.callTool("search_rentals", { sort: "CHEAPEST" });
    assert.equal(textOf(enumOut), "search_rentals: argument sort has the wrong type");
    const statusOut = await c.callTool("get_building_listings", { id: "B1", status: "SOLD" });
    assert.equal(textOf(statusOut), "get_building_listings: argument status has the wrong type");
  });

  it("reports a missing required argument with the pinned text", async () => {
    const { client: c, calls } = client();
    const out = await c.callTool("get_property", {});
    assert.equal(textOf(out), "get_property: missing required argument: id");
    const urlOut = await c.callTool("get_property_by_url", {});
    assert.equal(textOf(urlOut), "get_property_by_url: missing required argument: url");
    assert.equal(calls.length, 0);
  });

  it("checks wrong types before missing required arguments", async () => {
    const { client: c } = client();
    const out = await c.callTool("get_building_listings", { page: "x" });
    assert.equal(textOf(out), "get_building_listings: argument page has the wrong type");
  });
});

describe("local validation: search exclusivity and flags", () => {
  it("rejects more than one of areas, location, locations", async () => {
    const { client: c, calls } = client();
    const out = await c.callTool("search_rentals", { areas: ["100"], location: "Brooklyn" });
    assert.equal(textOf(out), "use either areas, location, or locations, not more than one");
    const salesOut = await c.callTool("search_sales", {
      location: "Queens",
      locations: ["Queens"],
    });
    assert.equal(textOf(salesOut), "use either areas, location, or locations, not more than one");
    assert.equal(calls.length, 0);
  });

  it("rejects false for each true-only flag", async () => {
    const { client: c } = client();
    const noFee = await c.callTool("search_rentals", { noFee: false });
    assert.equal(textOf(noFee), "noFee accepts true or must be omitted");
    const openHouse = await c.callTool("search_rentals", { hasOpenHouse: false });
    assert.equal(textOf(openHouse), "hasOpenHouse accepts true or must be omitted");
    const tour = await c.callTool("search_sales", { has3dTour: false });
    assert.equal(textOf(tour), "has3dTour accepts true or must be omitted");
  });

  it("rejects noFee on a sale search with the broker-fee text", async () => {
    const { client: c, calls } = client();
    const out = await c.callTool("search_sales", { noFee: true });
    assert.equal(
      textOf(out),
      "noFee is not accepted for sale search: a broker fee is something you pay to rent",
    );
    assert.equal(calls.length, 0);
  });

  it("rejects more than 10 areas entries, as an array and as a comma string", async () => {
    const { client: c } = client();
    const eleven = Array.from({ length: 11 }, (_, i) => String(100 + i));
    const arrayOut = await c.callTool("search_rentals", { areas: eleven });
    assert.equal(textOf(arrayOut), "areas accepts at most 10 area IDs per call");
    const stringOut = await c.callTool("search_sales", { areas: eleven.join(",") });
    assert.equal(textOf(stringOut), "areas accepts at most 10 area IDs per call");
    const tenOut = await c.callTool("search_rentals", { areas: eleven.slice(0, 10) });
    assert.equal(tenOut.isError, undefined);
  });
});

describe("local validation: compare_neighborhoods", () => {
  it("rejects neither and both of areas / locations", async () => {
    const { client: c, calls } = client();
    const neither = await c.callTool("compare_neighborhoods", {});
    assert.equal(textOf(neither), "use either areas or locations, not both");
    const both = await c.callTool("compare_neighborhoods", {
      areas: ["100"],
      locations: ["Manhattan"],
    });
    assert.equal(textOf(both), "use either areas or locations, not both");
    assert.equal(calls.length, 0);
  });

  it("rejects lists outside 1-5 entries, array and comma-string forms", async () => {
    const { client: c } = client();
    const six = await c.callTool("compare_neighborhoods", {
      locations: ["A", "B", "C", "D", "E", "F"],
    });
    assert.equal(textOf(six), "compare_neighborhoods compares 1-5 neighborhoods");
    const sixString = await c.callTool("compare_neighborhoods", { areas: "1,2,3,4,5,6" });
    assert.equal(textOf(sixString), "compare_neighborhoods compares 1-5 neighborhoods");
    const empty = await c.callTool("compare_neighborhoods", { areas: [] });
    assert.equal(textOf(empty), "compare_neighborhoods compares 1-5 neighborhoods");
  });

  it("forwards a valid two-neighborhood comparison", async () => {
    const { client: c, calls } = client();
    const out = await c.callTool("compare_neighborhoods", { locations: "Astoria, Sunnyside" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out.content, SAMPLE_CONTENT);
    assert.equal(methods(calls).filter((m) => m === "tools/call").length, 1);
  });

  it("counts entries as array length or comma-split count", () => {
    assert.equal(countEntries(["a", "b"]), 2);
    assert.equal(countEntries("a, b ,c"), 3);
    assert.equal(countEntries(""), 0);
    assert.equal(countEntries([]), 0);
  });
});

describe("upstream error propagation", () => {
  it("propagates an upstream isError result with its content unchanged", async () => {
    const errContent = [{ type: "text", text: "tier gate: starter plan" }];
    const { client: c } = client({ callResult: { content: errContent, isError: true } });
    const out = await c.callTool("search_sales", { location: "Bronx" });
    assert.equal(out.isError, true);
    assert.deepEqual(out.content, errContent);
  });

  it("maps a JSON-RPC error object to an isError carrying its message", async () => {
    const upstream = makeUpstream();
    const rpcErrorFetch: FetchFn = async (url, init) => {
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      if (body.method === "tools/call") {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "Invalid params: unknown area" },
        });
      }
      return upstream.fetchFn(url, init);
    };
    const c = new BoroughClient({ fetchFn: rpcErrorFetch, env: KEY_ENV });
    const out = await c.callTool("list_areas", {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "Invalid params: unknown area");
  });

  it("maps a non-2xx tools/call response to the HTTP error text", async () => {
    const { client: c } = client({ callHttpStatus: 500 });
    const out = await c.callTool("list_areas", {});
    assert.equal(textOf(out), "upstream error: HTTP 500 from borough-mcp");
  });

  it("maps a non-2xx initialize response to the HTTP error text", async () => {
    const { client: c } = client({ initHttpStatus: 503 });
    const out = await c.callTool("list_areas", {});
    assert.equal(textOf(out), "upstream error: HTTP 503 from borough-mcp");
  });

  it("maps a throwing fetch to upstream unreachable, on call and on initialize", async () => {
    const onCall = client({ throwOn: "tools/call" });
    const callOut = await onCall.client.callTool("list_areas", {});
    assert.equal(textOf(callOut), "upstream unreachable: borough-mcp");
    const onInit = client({ throwOn: "initialize" });
    const initOut = await onInit.client.callTool("list_areas", {});
    assert.equal(textOf(initOut), "upstream unreachable: borough-mcp");
  });
});
