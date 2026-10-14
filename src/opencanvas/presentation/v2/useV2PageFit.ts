import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { ScenePage } from '../../domain/document/types';
import type { PixiRendererHost, PixiRendererStatus } from '../../infrastructure/pixi/PixiRendererHost';
import { clearance } from './map/mapMode';
import type { useV2Camera } from './useV2Camera';
import type { useV2Panels } from './useV2Panels';
import { landingDirectionOf } from './v2Landing';

interface PageFitInput {
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly page: ScenePage | null;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly fitKey: string | undefined;
  readonly rendererStatus: PixiRendererStatus;
  readonly mapActive: boolean;
  /** A page the camera is kept for (a drawing shown where its map was). */
  readonly keepCameraOnPage: MutableRefObject<string | null>;
}

/** Where the camera lands: the document on open, a page when it is switched to, the page beside the Animation panel. */
export function useV2PageFit({ camera, panels, session, page, pageRef, hostRef, fitKey, rendererStatus, mapActive, keepCameraOnPage }: PageFitInput): void {
  const rendererReady = rendererStatus === 'ready';
  // The Animation panel is about the whole page: opening it lands the page readable beside it.
  useEffect(() => { if (panels.motionOpen) camera.landReadable(landingDirectionOf(pageRef.current)); }, [panels.motionOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    camera.fitOnOpen(rendererStatus, session.document, fitKey, session.revision, landingDirectionOf(pageRef.current), mapActive);
  }, [rendererStatus, session.document, session.revision, fitKey, camera, mapActive, pageRef]);
  // A page switch lands on that page's content, readable (never below the label floor);
  // the canvas only ever renders one page, so the landing is already page-scoped.
  const fittedPageRef = useRef<string | null>(null);
  // A new document opens through fitOnOpen, not as a page switch.
  useEffect(() => { fittedPageRef.current = null; }, [fitKey]);
  useEffect(() => {
    if (!page || !rendererReady) return;
    if (fittedPageRef.current === page.id) return;
    const first = fittedPageRef.current === null;
    fittedPageRef.current = page.id;
    const kept = keepCameraOnPage.current === page.id;
    keepCameraOnPage.current = null;
    if (!first && !mapActive && !kept) camera.landReadable(landingDirectionOf(pageRef.current));
    // A drawing shown where its map was: Canvas has a creation rail on the left that Map had not, so a box left under it
    // moves out by the rail's width (never more: the drawing stays where the reader was looking).
    if (kept && !mapActive) requestAnimationFrame(() => {
      const host = hostRef.current;
      const bounds = host?.getContentBounds();
      if (!host || !bounds) return;
      const cam = camera.cameraRef.current;
      const under = clearance(host).left - (bounds.x * cam.zoom + cam.x);
      if (under > 0 && under < 160) camera.animateTo({ ...cam, x: cam.x + under });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, rendererReady]);
}
