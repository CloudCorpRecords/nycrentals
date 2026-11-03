# nycrentals

New York City homes, searched the way the city is actually
organised: by borough and neighborhood. nycrentals is a thin,
validating bridge to the hosted Borough MCP service — it
exposes ten tools for finding rentals and homes for sale
across Manhattan, Brooklyn, Queens, the Bronx and Staten
Island, opening the listing or building behind a search
result, and reading the market around a neighborhood before
you commit to a viewing.

The bridge does two jobs. It serves the tool list locally,
and it checks every call before anything leaves the machine:
argument types, required fields, and the service's own
house rules — pick one way of naming a place (`areas`,
`location` or `locations`, never a mix), fee and tour flags
that only ever switch on, no broker-fee flag on a sale
search, at most ten area IDs in one search, and comparisons
that stay between one and five neighborhoods. Calls that
pass are forwarded over a single upstream session that is
opened once and reused, and whatever the service answers —
listings with prices, photos and freshness markers — comes
back untouched.

The ten tools:

- `search_rentals` — active rentals across all five
  boroughs, filterable by price, beds and baths, square
  footage, amenities, building type, pet policy, transit
  score and internet speed, with no-fee, open-house and
  3D-tour switches.
- `search_sales` — active for-sale listings with the same
  filters plus a sale-type selector.
- `get_property` — one listing in full: price, address,
  beds and baths, amenities, pet policy and building
  scores, in a compact form suited to chat clients.
- `get_property_by_url` — the same detail reached from a
  listing's URL path instead of its ID.
- `get_building` — a building's profile: type, year built,
  floors and units, amenities, policies, management and
  tax-abatement status.
- `get_building_listings` — the listings tied to one
  building, cheapest first.
- `list_areas` — the area directory itself: 316
  neighborhoods and sub-areas, the five boroughs, and
  Northern New Jersey coverage, paginated.
- `get_market_snapshot` — current market statistics for a
  neighborhood.
- `get_market_trends` — recent price movement for a
  neighborhood, one row per date and event type.
- `compare_neighborhoods` — one to five neighborhoods side
  by side.

Area IDs follow the borough hundreds: Manhattan is 100,
the Bronx 200, Brooklyn 300, Queens 400 and Staten Island
500, with neighborhoods numbered inside their borough.

## Configuration

One credential, read from the environment:

```bash
export BOROUGH_API_KEY="..."
```

Every tool needs the key. Without it, calls fail
immediately with `BOROUGH_API_KEY is not set` and nothing
is sent anywhere. Access tiers are enforced by the hosted
service, not by this bridge.

## CLI

Each tool is a subcommand taking one JSON argument string:

```bash
npx @reneturcios/nycrentals search_rentals '{"location":"Brooklyn","maxPrice":3500,"noFee":true}'
npx @reneturcios/nycrentals get_property '{"id":"..."}'
npx @reneturcios/nycrentals compare_neighborhoods '{"locations":["Astoria","Jackson Heights"]}'
npx @reneturcios/nycrentals --version
```

Output is the forwarded result content as JSON. Exit
codes: `0` on success, `1` on an error result (including a
validation or upstream failure), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/nycrentals mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "nycrentals": {
      "command": "npx",
      "args": ["-y", "@reneturcios/nycrentals", "mcp"],
      "env": { "BOROUGH_API_KEY": "..." }
    }
  }
}
```

## Docker

```bash
docker run -i -e BOROUGH_API_KEY="..." ghcr.io/cloudcorprecords/nycrentals
docker run --rm -e BOROUGH_API_KEY="..." ghcr.io/cloudcorprecords/nycrentals list_areas '{"level":1}'
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake MCP upstream, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
