import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ShapeKind } from '../../domain/nodes/shapeNode';
import type { V2Tool } from './V2CreationToolbar';
import { DEFAULT_TOOL_CONFIG, type V2ConnectorTool, type V2ToolConfig } from './v2ToolCatalog';
import type { V2GestureApi } from './v2PointerGestures';

/** The armed tool, its variant, and Space-to-pan: state plus the refs the pointer layer reads without re-rendering. */
export function useV2ToolState(gestureApiRef: RefObject<V2GestureApi | null>) {
  const [tool, setTool] = useState<V2Tool>('select');
  // Which variant a flyout tool draws with; its grid marks the last pick.
  const [toolConfig, setToolConfig] = useState<V2ToolConfig>(DEFAULT_TOOL_CONFIG);
  const [spacePan, setSpacePan] = useState(false);
  const toolRef = useRef(tool);
  const toolConfigRef = useRef(toolConfig);
  const spacePanRef = useRef(spacePan);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { toolConfigRef.current = toolConfig; }, [toolConfig]);
  useEffect(() => { spacePanRef.current = spacePan; }, [spacePan]);

  const pickShape = useCallback((shape: ShapeKind) => {
    setToolConfig((config) => ({ ...config, shape }));
    setTool('shape');
  }, []);
  const pickConnector = useCallback((connector: V2ConnectorTool) => {
    setToolConfig((config) => ({ ...config, connector }));
    setTool('connector');
  }, []);

  useEffect(() => {
    const resetInput = () => {
      setSpacePan(false);
      gestureApiRef.current?.cancelGesture();
    };
    window.addEventListener('blur', resetInput);
    return () => window.removeEventListener('blur', resetInput);
  }, [gestureApiRef]);
  return { tool, setTool, toolConfig, spacePan, setSpacePan, toolRef, toolConfigRef, spacePanRef, pickShape, pickConnector };
}
