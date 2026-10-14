import { useRef, useState } from 'react';
import { TURNSTILE_SITE_KEY } from '../../../services/share/turnstile';
import type { ContextMenuTarget } from './V2ContextMenu';
import type { V2ExportScope } from './v2Export';

/** Export is one panel with two doors: the canvas menu (Page) and an element's context menu (Selection + its subtree). */
export function useV2ExportPanel(contextMenu: ContextMenuTarget | null, shared: boolean) {
  // One instance, so both doors share state.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<V2ExportScope>('page');
  const [exportPoint, setExportPoint] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const exportPointRef = useRef<HTMLDivElement | null>(null);
  const exportAnchorRef = useRef<HTMLElement | null>(null);
  // Which door opened it: the bar at the right edge opens toward the inside, Share shows only the link.
  const [exportDoor, setExportDoor] = useState<'menu' | 'menu-share' | 'bar-export' | 'bar-share'>('menu');
  const openExport = (anchor: HTMLElement | null, scope: V2ExportScope, door: typeof exportDoor = 'menu') => {
    exportAnchorRef.current = anchor;
    setExportScope(scope);
    setExportDoor(door);
    setExportOpen(true);
  };
  const toggleBarPanel = (anchor: HTMLElement, door: 'bar-export' | 'bar-share') => {
    if (exportOpen && exportDoor === door) setExportOpen(false);
    else openExport(anchor, 'page', door);
  };
  // Share opens anywhere but a shared viewer: the editable link needs nothing; the read-only link needs the share service.
  const canShare = !shared && Boolean(TURNSTILE_SITE_KEY);
  // The context menu is still open here; the panel takes over its click point.
  const openElementExport = () => {
    const point = contextMenu;
    if (!point || point.kind === 'canvas') return;
    setExportPoint({ x: point.x, y: point.y });
    openExport(exportPointRef.current, 'selection');
  };
  return { exportOpen, setExportOpen, exportScope, exportPoint, exportPointRef, exportAnchorRef, exportDoor, openExport, toggleBarPanel, canShare, openElementExport };
}
