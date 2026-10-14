import { useMemo } from 'react';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { ScenePage } from '../../domain/document/types';
import type { ToastItem } from '../design-system';
import { V2ExportMenu } from './V2ExportMenu';
import { V2ShareBar } from './V2Workspace';
import type { useV2MapMode } from './map/useV2MapMode';
import type { useV2ExportPanel } from './useV2ExportPanel';

interface EditorExportProps {
  readonly exportPanel: ReturnType<typeof useV2ExportPanel>;
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly page: ScenePage;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly selectedNodeIds: readonly string[];
  readonly selectedConnectorIds: readonly string[];
  readonly shared: boolean;
  readonly onExported: () => void;
  readonly onOpenAnimation: () => void;
  readonly pushToast: (toast: ToastItem) => void;
  readonly focusCanvas: () => void;
}

/** The export and share panel, with the 1×1 anchor an element's context menu hands it. */
export function V2EditorExport(p: EditorExportProps): React.JSX.Element {
  const { exportPanel, session, page, map } = p;
  const { exportOpen, exportDoor, setExportOpen, exportPointRef, exportAnchorRef, exportPoint, exportScope, canShare, toggleBarPanel } = exportPanel;
  // Export, like the canvas, takes what is on screen: in Map mode the map's scene stands in for the page.
  const exportDocument = useMemo(() => {
    const document = session.document;
    if (!document || !map.mapPage || map.start) return document;
    return { ...document, pages: document.pages.map((candidate) => (candidate.id === page.id ? { ...map.mapPage!, id: page.id } : candidate)) };
  }, [session.document, page, map.mapPage, map.start]);
  return (
    <>
      {/* The export panel's click-point anchor; 1×1 and never interactive. */}
      <div ref={exportPointRef} aria-hidden="true" style={{
        position: 'fixed', left: exportPoint?.x ?? 0, top: exportPoint?.y ?? 0,
        width: 1, height: 1, pointerEvents: 'none',
      }} />
      <V2ExportMenu open={exportOpen} anchorRef={exportAnchorRef} initialScope={exportScope}
        section={exportDoor.endsWith('share') ? 'share' : 'export'} placement={exportDoor.startsWith('bar') ? 'bottom-end' : 'bottom-start'}
        document={exportDocument!} sourceDocument={session.document!} pageId={page.id} canShare={canShare}
        selectedNodeIds={p.selectedNodeIds} selectedConnectorIds={p.selectedConnectorIds}
        onClose={() => {
          setExportOpen(false);
          // Element export returns you to the canvas; the bar keeps its own focus.
          if (exportAnchorRef.current === exportPointRef.current) p.focusCanvas();
        }}
        onToast={(title, tone, extra) => { p.pushToast({ id: `export-${Date.now()}`, tone, title, ...extra }); if (tone === 'success') p.onExported(); }}
        onOpenAnimation={p.onOpenAnimation} />
      <V2ShareBar canShare={!p.shared} shareOpen={exportOpen && exportDoor === 'bar-share'} exportOpen={exportOpen && exportDoor === 'bar-export'}
        onShare={(anchor) => toggleBarPanel(anchor, 'bar-share')} onExport={(anchor) => toggleBarPanel(anchor, 'bar-export')} />
    </>
  );
}
