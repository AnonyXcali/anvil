import { z } from 'zod';

export const HISTORY_FILE_PATH = 'architecture/HISTORY.md';
export const BUGS_FILE_PATH = 'architecture/BUGS.md';

export const Z_HISTORY_ENTRY_INPUT = z.object({
  subject: z.string().min(1),
  status: z.enum(['success', 'failed']),
  changesMade: z.string().min(1),
  files: z.array(z.string().min(1)).default([]),
  actor: z.string().min(1),
  bugId: z.string().min(1).optional(),
  milestoneId: z.string().min(1).optional(),
  validator: z.string().min(1).optional(),
  originatingRunId: z.string().min(1).optional(),
  repairRunId: z.string().min(1).optional(),
  attempt: z.number().int().nonnegative().optional(),
  classification: z.string().min(1).optional(),
});

export type HistoryEntryInput = z.infer<typeof Z_HISTORY_ENTRY_INPUT>;
