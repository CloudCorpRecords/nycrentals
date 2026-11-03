/**
 * nycrentals types.
 *
 * Ten tools that forward to the hosted Borough MCP endpoint.
 * The rebuild serves tools/list locally and validates every
 * tools/call argument set itself before forwarding; a call
 * that passes validation is sent upstream over a Streamable
 * HTTP session and the upstream result content is returned
 * unchanged.
 */

/** A tool's arguments, as decoded JSON. */
export type ToolArgs = Record<string, unknown>;

/** The result shape shared by the MCP handler and the CLI. */
export interface ToolResult {
  content: unknown;
  isError?: boolean;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the client, all injectable in tests. */
export interface BoroughDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Environment (BOROUGH_API_KEY). Defaults to process.env. */
  env?: Record<string, string | undefined>;
}
