// The docs' order and one-line pitch, shared by the sidebar (astro.config.mjs) and llms.txt (src/pages/llms.txt.ts),
// so an agent reading the index sees the pages a person sees, in the same groups.

// Inside "Diagram types" the group already says what they are: Flowchart, not Flowchart diagrams.
export const DIAGRAM_TYPE_LABELS = {
  'diagram-flowchart': 'Flowchart', 'diagram-architecture': 'Architecture', 'diagram-sequence': 'Sequence',
  'diagram-state': 'State', 'diagram-erd': 'ERD', 'diagram-class': 'Class', 'diagram-mindmap': 'Mind map',
  'diagram-gitgraph': 'Git graph', 'diagram-chart': 'Chart', 'diagram-wireframe': 'Wireframe',
};
export const DIAGRAM_TYPES = Object.keys(DIAGRAM_TYPE_LABELS);

export const CURATED = {
  'Get started': ['introduction', 'quick-start', 'templates', 'local-first-diagramming', 'faq'],
  'Agents & MCP': ['connect-your-agent', 'mcp-server', 'webmcp', 'prompting-agents', 'ai-generation', 'cli', 'github-action'],
  'Write diagrams': ['openflow-dsl', { 'Diagram types': DIAGRAM_TYPES }, 'mermaid-import', 'coming-from-structurizr'],
  'Draw on the canvas': ['canvas-basics', 'shapes-and-connectors', 'insert-media', 'context-menu', 'properties-panel'],
  'Architecture & maps': ['map-mode', 'architecture-c4', 'architecture-workspace'],
  'Share & export': ['exporting', 'animated-export', 'share-links'],
  Reference: ['openflow-dsl-reference', 'keyboard-shortcuts', 'settings', 'theming', 'self-hosting'],
};
export const TAGLINE = 'Architecture diagrams you draw, write as code, or hand to your agent.';
export const SUBLINE = 'Free, open source and local-first. Paste a GitHub repo and get its map, every arrow cited to a line of code.';
