import { z } from 'zod';

export const HISTORY_FILE_PATH = 'architecture/HISTORY.md';

export const Z_HISTORY_ENTRY_INPUT = z.object({
  subject: z.string().min(1),
  status: z.enum(['success', 'failed']),
  changesMade: z.string().min(1),
  files: z.array(z.string().min(1)).default([]),
  actor: z.string().min(1),
});

export type HistoryEntryInput = z.infer<typeof Z_HISTORY_ENTRY_INPUT>;
