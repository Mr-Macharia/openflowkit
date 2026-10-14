import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../lib/version.js';
import { registerViewer } from '../lib/card.js';
import { registerRemoteTools, type RemoteToolOptions } from './tools.js';

export interface RemoteServerOptions extends Pick<RemoteToolOptions, 'deadlineMs' | 'layout'> {
  readonly viewerHtml: string;
  readonly appOrigin: string;
}

/** A fresh server per request: stateless, nothing shared between callers. */
export function createRemoteServer({ viewerHtml, appOrigin, ...tool }: RemoteServerOptions): McpServer {
  const server = new McpServer({ name: `${MCP_SERVER_NAME}-remote`, version: MCP_SERVER_VERSION });
  registerRemoteTools(server, { appOrigin, ...tool });
  // The card's preview draws with the same layout engine as render_diagram.
  registerViewer(server, () => viewerHtml, tool.layout ? { layout: tool.layout } : {});
  return server;
}
