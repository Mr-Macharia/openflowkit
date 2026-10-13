# OpenCanvas Document History

Bounded undo/redo over canonical commands.

- one committed command or batch creates one history entry;
- new commits clear redo history;
- empty undo/redo returns the same state reference;
- past and future stacks obey a configurable positive limit;
- history owns no renderer or persistence behavior.

The document session (`../session/session.ts`) commits document edits through it
and exposes undo/redo from it. Each entry keeps the command and its inverse, not a
document snapshot.
