import { useCallback } from 'react';
import { compileSource } from '../../../agent/compileSource';
import { compile, compileWorkspace, type CompileWorkspaceResult } from '../../../dsl/compile';
import { elkDslLayoutPort } from '../../../services/elk-layout/runtime';
import { resolveDslIcon } from '../../../services/dsl/iconResolver';
import type { Point2d } from '../../domain/geometry/types';
import type { useV2Preferences } from './useV2Preferences';

/** The three ways the editor reads text into a scene, each bound to the palette and icon preferences. */
export function useV2Compilers({ diagramPalette, autoIcons }: Pick<ReturnType<typeof useV2Preferences>['preferences'], 'diagramPalette' | 'autoIcons'>) {
  // What the assistant writes: DSL, or Mermaid, Structurizr or D2, read as the code panel and the MCP tools read them.
  const compileDraft = useCallback(
    (text: string) => compileSource(text, { origin: { x: 0, y: 0 }, layout: elkDslLayoutPort, resolveIcon: resolveDslIcon, autoIcons }),
    [autoIcons]);
  const compileAny = useCallback(
    (text: string): Promise<CompileWorkspaceResult> => compileWorkspace(text, {
      origin: { x: 0, y: 0 }, layout: elkDslLayoutPort, resolveIcon: resolveDslIcon,
      appearance: { palette: diagramPalette }, autoIcons,
    }),
    [diagramPalette, autoIcons]);
  const compileAt = useCallback((text: string, origin: Point2d) => compile(text, {
    origin, layout: elkDslLayoutPort, resolveIcon: resolveDslIcon,
    appearance: { palette: diagramPalette }, autoIcons,
  }), [diagramPalette, autoIcons]);
  return { compileDraft, compileAny, compileAt };
}
