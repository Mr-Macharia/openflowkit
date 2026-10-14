import { isImageFile } from '../../../services/storage/assets';
import { track } from '../../../services/usage/usage';
import type { UsageEvent } from '../../../services/usage/usageEvents';
import type { DocumentCommand } from '../../domain/commands/types';

export const imageFiles = (list: DataTransfer | null): File[] => Array.from(list?.files ?? []).filter(isImageFile);
export const insertsNode = (command: DocumentCommand): boolean =>
  command.kind === 'insert-node' || (command.kind === 'batch' && command.commands.some(insertsNode));
/** A diagram made one way counts once it is drawn. */
export const counted = (way: UsageEvent) => (committed: boolean) => { if (committed) track(way); };
