# nycrentals — Build Report (Batch 21)

Rebuild of the Borough MCP server (npm `@borough/mcp`,
registry `app.qwady/borough`) from the firsthand spec in
`specs-batch21/nycrentals.md`. Built 2026-10-27.

## Identity

- npm: `@reneturcios/nycrentals` @ 0.1.0, bin `nycrentals` → `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/nycrentals`
  (matches `package.json` `mcpName`, `server.json` `name`, and
  the Dockerfile `io.modelcontextprotocol.server.name` label)
- server.json description (92 chars, verified):
  "Borough NYC real estate: rental and sales search, property and building detail, market data."
- server.json: npm package entry carries `"version": "0.1.0"`;
  the OCI entry (`ghcr.io/cloudcorprecords/nycrentals:0.1.0`)
  carries **no** `version` field.

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/swissreg/tsconfig.json, verified
with `cmp`), .gitignore, package-lock.json, README.md (fresh
prose), LICENSE (MIT, © 2026 Rene Turcios), CHANGELOG.md
(single 0.1.0 entry dated 2026-10-27), src/index.ts,
src/cli.ts, src/mcp.ts, src/types.ts, src/borough.ts (core),
test/borough.test.ts, and the four workflows under
.github/workflows/ (publish-container adapted:
IMAGE ghcr.io/cloudcorprecords/nycrentals, smoke assertion on
server name `nycrentals`).

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`, handlers
  for `ListToolsRequestSchema` / `CallToolRequestSchema`),
  serving tools/list locally from the core's explicit
  literals for all 10 tools (search_rentals, search_sales,
  get_property, get_property_by_url, get_building,
  get_building_listings, list_areas, get_market_snapshot,
  get_market_trends, compare_neighborhoods); no
  McpServer/zod registration. Tool descriptions and schemas
  are the fixture's, with `required` present only when
  non-empty.
- `src/borough.ts`: a forwarding client for
  `https://borough.qwady.app/mcp` through an injectable
  fetch. The `BOROUGH_API_KEY` gate runs before validation
  (absent key → isError `BOROUGH_API_KEY is not set`, no
  fetch). Local validation then runs in the spec's order —
  wrong type (`<tool>: argument <name> has the wrong type`,
  enums and integer-ness included), missing required
  (`<tool>: missing required argument: <name>`), the search
  exclusivity rule (`use either areas, location, or
  locations, not more than one`), true-only flags
  (`<name> accepts true or must be omitted`), the
  sale-search broker-fee rule (`noFee is not accepted for
  sale search: a broker fee is something you pay to rent`),
  the compare rules (`use either areas or locations, not
  both`; `compare_neighborhoods compares 1-5 neighborhoods`,
  entry count = array length or comma-split count), and
  the areas cap (`areas accepts at most 10 area IDs per
  call`). Forwarding follows the spec'd Streamable HTTP
  flow: a first-call initialize POST (protocolVersion
  "2025-03-26", clientInfo {name "nycrentals", version
  "0.1.0"}, capabilities {}), capture of the
  `mcp-session-id` response header, a
  notifications/initialized POST, then tools/call POSTs
  with the session header and the `Authorization: Bearer`
  header on every POST; the session is reused for the
  client's lifetime. The upstream result content is
  returned unchanged and an upstream isError is propagated;
  a JSON-RPC error object becomes an isError carrying its
  message, a non-2xx response becomes `upstream error:
  HTTP <status> from borough-mcp`, and a throwing fetch
  becomes `upstream unreachable: borough-mcp`.
- CLI: one subcommand per tool taking a JSON argument
  string (forwarding like the MCP path, printing the
  forwarded result content as JSON), `mcp`, `--version`;
  unknown subcommand → usage on stderr, exit 2; isError
  results exit 1.

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0. `npx tsc --noEmit`: exit 0.
- `npm test`: **23 tests, 23 pass, 0 fail** — a fake fetch
  implementing a fake MCP upstream only (initialize →
  session header → initialized → tools/call); no live
  network. Covers session establishment (handshake order,
  initialize payload, Bearer header on every POST, session
  header on the later POSTs, forwarded name/arguments,
  content returned unchanged) and session reuse (one
  handshake for two calls), key gating (absent key, and
  gating before validation, with zero fetches), every local
  validation rule above including the wrong-type-before-
  missing ordering and both array and comma-string entry
  counting, and error propagation (upstream isError with
  content unchanged, JSON-RPC error message, HTTP error on
  tools/call and on initialize, throwing fetch on
  tools/call and on initialize).
- `node dist/cli.js --version`: `0.1.0`; unknown command:
  usage on stderr, exit 2; a keyless tool call prints
  `error: BOROUGH_API_KEY is not set` and exits 1.
- Parity: `python3 harness/parity.py --original
  harness/fixtures/borough-mcp-tools-original.json --rebuild
  "stdio:node builds/nycrentals/dist/cli.js mcp" --out
  builds/nycrentals/parity-out` → **verdict=PASS
  parity_pct=100.0, 10/10 tools identical, no missing, no
  extra, no schema diffs**.
- Lockfile: Route 3 only — clean temp dir with
  package.json alone, `npm install --package-lock-only
  --ignore-scripts --offline`; parses, name
  `@reneturcios/nycrentals`, **128 package entries**;
  copied into the build dir and re-verified after the
  build-dir install (still 128 entries). Dependencies
  installed in the build dir with
  `npm install --offline --ignore-scripts`.

## Gap notes / deviations

- The search engine is the upstream's; the rebuild is a
  forwarding client with local validation — exactly the
  original package's own bridge architecture.
- The Streamable HTTP session flow is a documented
  reconstruction (the README pins the endpoint and the
  Bearer header, not the handshake); tier gating (Starter
  tools) is enforced upstream, not locally.
- No live call was made; behaviour is proven against a fake
  MCP upstream only.
- No push, no publish.
