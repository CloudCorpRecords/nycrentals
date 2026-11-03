/**
 * nycrentals MCP server. Tools: search_rentals, search_sales,
 * get_property, get_property_by_url, get_building,
 * get_building_listings, list_areas, get_market_snapshot,
 * get_market_trends, compare_neighborhoods.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list from the core's explicit literals, and
 * the core validates every tools/call argument set itself
 * before forwarding it upstream.
 *
 * Calls are forwarded to the hosted Borough MCP endpoint
 * over a session the client establishes once and reuses;
 * the upstream result content is returned unchanged and
 * validation and upstream failures come back as isError
 * results carrying the documented error strings.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient, TOOL_DEFS, TOOL_NAMES, VERSION } from "./borough.js";

const client = createClient();

const server = new Server(
  { name: "nycrentals", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!TOOL_NAMES.includes(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  const result = await client.callTool(name, (args ?? {}) as Record<string, unknown>);
  return {
    content: result.content as Array<{ type: "text"; text: string }>,
    ...(result.isError ? { isError: true as const } : {}),
  };
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
