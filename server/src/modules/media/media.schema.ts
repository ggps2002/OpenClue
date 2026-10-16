import { z } from 'zod';
import { MEDIA_KINDS } from './media.service';

export const listMediaQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  kind: z.enum(MEDIA_KINDS).optional(),
});

export const uploadMediaBodySchema = z.object({
  projectId: z.string().min(1).optional(),
});

export const updateMediaSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200).optional(),
    projectId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.projectId !== undefined, 'Nothing to update');

export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
