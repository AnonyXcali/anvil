import { z } from 'zod';

export const ProjectNameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
