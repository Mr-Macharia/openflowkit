// The same ELK the editor's worker runs, in process, for Node hosts (MCP file
// mode, the CLI). Only the agent bundle entry (index.ts) imports this: the
// editor reaches host.ts too, and must not ship the 1.4 MB engine in its entry.
// elkjs stays external in vite.agent.config.ts, so the MCP package resolves its own.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { LayoutPort } from '../dsl/layout';
import { createElkLayoutPort } from '../services/dsl/elkLayoutPort';
import { HEADLESS_LAYOUT_LIMITS } from './ops/types';

export { HEADLESS_LAYOUT_LIMITS } from './ops/types';

let elk: InstanceType<typeof ELK> | null = null;
const elkPort = createElkLayoutPort(async () => (elk ??= new ELK()));

// ponytail: a size cap, not a clock; ELK in worker_threads with a timeout if agents need bigger graphs.
export const headlessElkLayout: LayoutPort = {
  run(graph, signal) {
    const { nodes, edges } = HEADLESS_LAYOUT_LIMITS;
    if (graph.nodes.length > nodes || graph.edges.length > edges) {
      return Promise.reject(new RangeError(`This diagram has ${graph.nodes.length} shapes and ${graph.edges.length} connections; layout outside the app stops at ${nodes} shapes or ${edges} connections. Split it into smaller diagrams, or open it in the app.`));
    }
    return elkPort.run(graph, signal);
  },
};
