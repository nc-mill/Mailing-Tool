import { z } from 'zod';

/**
 * Jazykový tag podle 3.1.9. Ne `z.enum(['cs','en'])`: dvojice jazyků
 * zabetonovaná ve schématu nástroje by znamenala, že přidání jazyka je změna
 * kódu vrstvy AI.
 */
export const languageTag = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  .max(35);

export const toneEnum = z.enum(['formal', 'friendly', 'playful', 'urgent']);

export const listMergeTagsInput = z.object({});

export const extractBrandInput = z.object({
  url: z.string().url().describe('Adresa, kterou uživatel uvedl v konverzaci'),
});

export const composeTemplateInput = z.object({
  kind: z.enum(['newsletter', 'announcement', 'transactional', 'reengagement']),
  brief: z.string().min(10).max(2000),
  language: languageTag,
  tone: toneEnum.default('friendly'),
  brandProfileId: z.string().uuid().optional(),
  sectionCount: z.number().int().min(1).max(8).optional(),
});

export const writeCopyInput = z.object({
  blockId: z
    .string()
    .regex(/^b_[0-9a-z]{12}$/)
    .optional(),
  kind: z.enum(['headline', 'subhead', 'paragraph', 'bullets', 'cta_label', 'preheader']),
  instruction: z.string().min(3).max(1000),
  language: languageTag,
  tone: toneEnum,
  maxLength: z.number().int().min(10).max(2000).optional(),
});

export const suggestSubjectInput = z.object({
  summary: z.string().min(10).max(2000).describe('O čem e-mail je'),
  language: languageTag,
  count: z.number().int().min(1).max(8).default(5),
  includeEmoji: z.boolean().default(false),
});
