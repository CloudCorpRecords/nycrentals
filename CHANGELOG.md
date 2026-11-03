# Changelog

## 0.1.0 (2026-10-27)

- Initial release: ten MCP tools and matching CLI subcommands
  that forward to the hosted Borough MCP endpoint —
  `search_rentals` and `search_sales` (listing search across
  the five boroughs), `get_property` and `get_property_by_url`
  (listing detail), `get_building` and `get_building_listings`
  (building detail and its linked listings), `list_areas`
  (boroughs, neighborhoods and sub-areas), `get_market_snapshot`
  and `get_market_trends` (market statistics and price trends),
  and `compare_neighborhoods` (side-by-side comparison of 1-5
  neighborhoods).
- Calls are validated locally before forwarding (argument
  types, required arguments, the areas/location/locations
  exclusivity rules, true-only fee and tour flags, the
  sale-search broker-fee rule, and the areas caps), the API key
  comes from `BOROUGH_API_KEY`, and the upstream Streamable
  HTTP session is established once and reused for the life of
  the process.
