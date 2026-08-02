import { createRoute, z } from '@hono/zod-openapi';

const paletteSchema = z.object({
  primary: z.string().regex(/^#[0-9a-f]{6}$/),
  secondary: z.string().regex(/^#[0-9a-f]{6}$/),
  accent: z.string().regex(/^#[0-9a-f]{6}$/),
  background: z.string().regex(/^#[0-9a-f]{6}$/),
  text: z.string().regex(/^#[0-9a-f]{6}$/),
  source: z.record(z.string(), z.string()),
});

const typographySchema = z.object({
  headingStack: z.enum(['system', 'georgia', 'arial', 'verdana', 'tahoma', 'courier']),
  bodyStack: z.enum(['system', 'georgia', 'arial', 'verdana', 'tahoma', 'courier']),
  radius: z.number().int().min(0).max(16),
});

export const brandProfileResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  source_url: z.string().nullable(),
  logo_asset_id: z.string().uuid().nullable(),
  logo_dark_asset_id: z.string().uuid().nullable(),
  palette: paletteSchema,
  typography: typographySchema,
  tone: z.unknown(),
  default_profile: z.boolean(),
  extracted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const listProfilesRoute = createRoute({
  method: 'get',
  path: '/brand/profiles',
  tags: ['Brand'],
  responses: {
    200: {
      description: 'Seznam profilů značky',
      content: {
        'application/json': { schema: z.object({ data: z.array(brandProfileResponse) }) },
      },
    },
  },
});

export const createProfileRoute = createRoute({
  method: 'post',
  path: '/brand/profiles',
  tags: ['Brand'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(120),
            palette: paletteSchema.partial({ source: true }),
            typography: typographySchema,
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Profil založen ručně, bez extrakce',
      content: { 'application/json': { schema: brandProfileResponse } },
    },
  },
});

export const patchProfileRoute = createRoute({
  method: 'patch',
  path: '/brand/profiles/{profile_id}',
  tags: ['Brand'],
  request: {
    params: z.object({ profile_id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(120).optional(),
            palette: paletteSchema.partial().optional(),
            typography: typographySchema.partial().optional(),
            logo_asset_id: z.string().uuid().nullable().optional(),
            default_profile: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Profil upraven',
      content: { 'application/json': { schema: brandProfileResponse } },
    },
    404: { description: 'Profil neexistuje' },
  },
});

export const deleteProfileRoute = createRoute({
  method: 'delete',
  path: '/brand/profiles/{profile_id}',
  tags: ['Brand'],
  request: { params: z.object({ profile_id: z.string().uuid() }) },
  responses: {
    204: { description: 'Smazáno' },
    409: { description: 'Výchozí profil nejde smazat, dokud není jiný' },
  },
});
