import { useState } from 'react';
import type { ScenePage } from '../../domain/document/types';
import type { ContextMenuTarget } from './V2ContextMenu';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import { useV2FeatureTips } from './useV2FeatureTips';
import { useV2FeedbackPrompts } from './useV2FeedbackPrompts';
import type { useV2FlowPlayback } from './useV2FlowPlayback';
import type { useV2Panels } from './useV2Panels';
import type { V2TipId } from './v2FeatureTips';

interface EditorHintsInput {
  readonly shared: boolean;
  readonly loadReadOnly: boolean;
  readonly page: ScenePage | null;
  readonly editLocked: boolean;
  readonly rendererReady: boolean;
  readonly selectedCount: number;
  readonly aiConfigured: boolean;
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly playback: ReturnType<typeof useV2FlowPlayback>;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly exportOpen: boolean;
  readonly contextMenu: ContextMenuTarget | null;
  /** A label is being typed (a shape's or a connector's). */
  readonly typing: boolean;
  readonly agentConnected: boolean;
  /** On a map's drawing. */
  readonly onDrawing: boolean;
  readonly setAnnouncement: (message: string) => void;
}

/** Feature tips and feedback prompts: when they may show, and what a tip's button does. */
export function useV2EditorHints(i: EditorHintsInput) {
  const { panels, code } = i;
  const [exported, setExported] = useState(false);
  // Typing a label is not the moment: a tip or prompt waits, so the Escape that ends editing cannot eat it.
  const transient = panels.motionOpen || i.playback.flow !== null || panels.shortcutsOpen
    || i.exportOpen || i.contextMenu !== null || i.typing;
  // A prompt asks about the app, never in a shared view or an embed; side panels it steps aside from (useYielding).
  const feedback = useV2FeedbackPrompts({ enabled: !i.shared && !i.loadReadOnly && window.self === window.top, blocked: transient });
  const tips = useV2FeatureTips({
    page: i.page, readOnly: i.editLocked, rendererReady: i.rendererReady, selectedCount: i.selectedCount,
    aiConfigured: i.aiConfigured, workspace: panels.workspace, motionOpen: panels.motionOpen,
    blocked: transient || panels.workspace !== null || panels.treeOpen || feedback.prompt !== null
      // An agent is drawing: a coachmark would talk over it.
      || i.agentConnected
      // A map's drawing: the reader came to move boxes, and its own toast already says the way back.
      || i.onDrawing,
    exported,
    announce: i.setAnnouncement,
  });
  const runTip = (tip: V2TipId) => {
    tips.dismiss();
    if (tip === 'code') code.openNew();
    if (tip === 'assistant') panels.openWorkspace('assistant');
    if (tip === 'motion') panels.openMotion();
  };
  return { setExported, transient, feedback, tips, runTip };
}
