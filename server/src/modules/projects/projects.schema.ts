import { z } from 'zod';

export const projectNameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Keep the name under 120 characters'),
});

export type ProjectNameInput = z.infer<typeof projectNameSchema>;
