import { useEffect, type RefObject } from 'react';

// Shortcuts and paste listen on the editor, so with focus on <body> (a fresh load, a panel that closed with no
// opener to return to, a click on bare chrome) every key and ⌘V went nowhere. Hand those to the canvas.
export function useV2BodyFocusForward(sectionRef: RefObject<HTMLElement | null>, pasteRef: RefObject<(event: ClipboardEvent) => void>): void {
  useEffect(() => {
    const forward = (event: KeyboardEvent) => {
      const canvas = sectionRef.current;
      if (event.target !== document.body || !canvas) return;
      const copy = new KeyboardEvent('keydown', event);
      canvas.dispatchEvent(copy);
      if (copy.defaultPrevented) event.preventDefault();
    };
    // A paste is handled as it is, not re-dispatched: Gecko's ClipboardEvent constructor drops clipboardData.
    const paste = (event: ClipboardEvent) => { if (event.target === document.body) pasteRef.current(event); };
    document.addEventListener('keydown', forward);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('keydown', forward);
      document.removeEventListener('paste', paste);
    };
  }, [sectionRef, pasteRef]);
}
