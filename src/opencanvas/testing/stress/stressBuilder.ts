import type { CompileResult } from '../../../dsl/compile';
import {
  createProductionSceneNode,
  type ProductionNodeCatalogEntry,
} from '../../application/active-document/productionNodeCatalog';
import { createDefaultSceneLayer } from '../../domain/document/defaults';
import type { JsonObject } from '../../domain/document/json';
import type { ConnectorEndpoint, SceneConnector, SceneNode, ScenePage } from '../../domain/document/types';
import type { Point2d, Size2d } from '../../domain/geometry/types';
import { createShapeNode } from '../../domain/nodes/shapeNode';

export const LAYER_ID = 'default';
export const PAGE_ID = 'page-everything';
export const COLUMN_WIDTH = 3400;
export const COLUMN_GAP = 64;


export interface Packer {
  readonly place: (size: Size2d) => Point2d;
  readonly cursorY: number;
}

export function createPacker(originX: number, originY: number, maxWidth: number, gap: number): Packer {
  let x = originX;
  let y = originY;
  let rowHeight = 0;
  return {
    place(size) {
      if (x > originX && x + size.width > originX + maxWidth) {
        x = originX;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      const at = { x, y };
      x += size.width + gap;
      rowHeight = Math.max(rowHeight, size.height);
      return at;
    },
    get cursorY() {
      return y + rowHeight;
    },
  };
}

export interface CompiledBlock {
  readonly frame: SceneNode;
  readonly nodes: readonly SceneNode[];
  readonly connectors: readonly SceneConnector[];
}

export function compiledBlock(result: CompileResult): CompiledBlock {
  return { frame: result.frame, nodes: [...result.groups, ...result.nodes], connectors: result.connectors };
}

export function namespaceBlock(prefix: string, block: CompiledBlock): CompiledBlock {
  const renamed = new Map<string, string>();
  const rename = (id: string): string => {
    const existing = renamed.get(id);
    if (existing !== undefined) return existing;
    const next = `${prefix}-${id}`;
    renamed.set(id, next);
    return next;
  };
  const renameEndpoint = (endpoint: ConnectorEndpoint): ConnectorEndpoint =>
    endpoint.nodeId === null ? endpoint : { ...endpoint, nodeId: rename(endpoint.nodeId) };
  const frame = { ...block.frame, id: rename(block.frame.id) };
  return {
    frame,
    nodes: block.nodes.map((node) => ({
      ...node,
      id: rename(node.id),
      parentId: node.parentId === null ? null : rename(node.parentId),
    })),
    connectors: block.connectors.map((connector) => ({
      ...connector,
      id: rename(connector.id),
      source: renameEndpoint(connector.source),
      target: renameEndpoint(connector.target),
      labels: connector.labels.map((label) => ({ ...label, id: rename(label.id) })),
    })),
  };
}

function shiftPoint(point: Point2d, delta: Point2d): Point2d {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

export function shiftBlock(block: CompiledBlock, delta: Point2d): CompiledBlock {
  const shiftNode = (node: SceneNode): SceneNode => ({
    ...node,
    transform: { ...node.transform, translation: shiftPoint(node.transform.translation, delta) },
  });
  return {
    frame: shiftNode(block.frame),
    nodes: block.nodes.map((node) => (node.parentId === block.frame.id ? shiftNode(node) : node)),
    connectors: block.connectors.map((connector) =>
      connector.waypoints.length === 0
        ? connector
        : { ...connector, waypoints: connector.waypoints.map((point) => shiftPoint(point, delta)) }
    ),
  };
}

export interface TextOptions {
  readonly size?: Size2d;
  readonly fontSize?: number;
  readonly fontWeight?: string;
  readonly color?: string;
  readonly customColor?: string;
  readonly backgroundColor?: string;
}

export interface PackOptions<T> {
  readonly sizeOf: (item: T) => Size2d;
  readonly place: (at: Point2d, item: T) => void;
  readonly maxWidth?: number;
  readonly gap?: number;
}

export interface StressBuilder {
  readonly page: ScenePage;
  readonly nodes: readonly SceneNode[];
  readonly connectors: readonly SceneConnector[];
  readonly cursorY: number;
  readonly nextId: (prefix: string) => string;
  readonly add: (node: SceneNode) => SceneNode;
  readonly addConnector: (connector: SceneConnector) => SceneConnector;
  readonly addText: (label: string, at: Point2d, options?: TextOptions) => SceneNode;
  readonly heading: (label: string) => void;
  readonly subheading: (label: string) => void;
  readonly advance: (amount: number) => void;
  readonly setCursor: (y: number) => void;
  readonly pack: <T>(items: readonly T[], options: PackOptions<T>) => void;
  readonly appendBlock: (prefix: string, block: CompiledBlock, at: Point2d) => void;
}

export function createBuilder(): StressBuilder {
  const nodes: SceneNode[] = [];
  const connectors: SceneConnector[] = [];
  let cursorY = 0;
  let counter = 0;
  const builder: StressBuilder = {
    get page(): ScenePage {
      return {
        id: PAGE_ID,
        name: 'Everything',
        diagramKind: 'flowchart',
        layers: [createDefaultSceneLayer()],
        nodes,
        connectors,
        metadata: {},
        extensions: {},
      };
    },
    get nodes() {
      return nodes;
    },
    get connectors() {
      return connectors;
    },
    get cursorY() {
      return cursorY;
    },
    nextId(prefix) {
      counter += 1;
      return `${prefix}-${counter}`;
    },
    add(node) {
      const placed = { ...node, zIndex: nodes.length };
      nodes.push(placed);
      return placed;
    },
    addConnector(connector) {
      connectors.push(connector);
      return connector;
    },
    addText(label, at, options = {}) {
      const fontSize = options.fontSize ?? 20;
      const size = options.size ?? { width: label.length * 11 + 40, height: fontSize + 12 };
      const base = createShapeNode(builder.page, { kind: 'text', id: builder.nextId('text'), at, size, label });
      return builder.add({
        ...base,
        content: {
          ...base.content,
          ...(options.fontSize === undefined ? {} : { fontSize: options.fontSize }),
          ...(options.fontWeight === undefined ? {} : { fontWeight: options.fontWeight }),
          ...(options.color === undefined ? {} : { color: options.color }),
          ...(options.customColor === undefined ? {} : { customColor: options.customColor }),
          ...(options.backgroundColor === undefined ? {} : { backgroundColor: options.backgroundColor }),
        },
      });
    },
    heading(label) {
      builder.addText(label, { x: 0, y: cursorY }, {
        size: { width: 2200, height: 56 }, fontSize: 34, fontWeight: '700', customColor: '#0f172a',
      });
      cursorY += 92;
    },
    subheading(label) {
      builder.addText(label, { x: 0, y: cursorY }, {
        size: { width: 1800, height: 36 }, fontSize: 20, fontWeight: '600', customColor: '#475569',
      });
      cursorY += 56;
    },
    advance(amount) {
      cursorY += amount;
    },
    setCursor(y) {
      cursorY = y;
    },
    pack(items, options) {
      const packer = createPacker(0, cursorY, options.maxWidth ?? COLUMN_WIDTH, options.gap ?? COLUMN_GAP);
      for (const item of items) options.place(packer.place(options.sizeOf(item)), item);
      cursorY = packer.cursorY + 140;
    },
    appendBlock(prefix, block, at) {
      const placed = shiftBlock(namespaceBlock(prefix, block), at);
      nodes.push(placed.frame);
      nodes.push(...placed.nodes);
      connectors.push(...placed.connectors);
    },
  };
  return builder;
}

export function catalogNode(builder: StressBuilder, catalogId: string, at: Point2d, content: JsonObject = {}): SceneNode {
  return builder.add(createProductionSceneNode(catalogId, builder.nextId(catalogId), at, LAYER_ID, content));
}

export function packCatalogNodes(builder: StressBuilder, entries: readonly ProductionNodeCatalogEntry[]): void {
  builder.pack(entries, {
    sizeOf: (entry) => entry.size,
    place: (at, entry) => {
      catalogNode(builder, entry.id, at);
    },
  });
}
