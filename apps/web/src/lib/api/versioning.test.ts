import { describe, it, expect } from 'vitest';
import type { ApiError } from '@mlain/core/errors/api-error';
import {
  API_VERSIONS,
  versionFromPath,
  deprecationHeaders,
  assertVersionSupported,
} from './versioning';

describe('verzování', () => {
  it('v1 je aktivní', () => {
    expect(API_VERSIONS.v1!.phase).toBe('active');
  });

  it('vyčte verzi z cesty', () => {
    expect(versionFromPath('/api/v1/contacts')).toBe('v1');
    expect(versionFromPath('/api/v2/contacts')).toBe('v2');
    expect(versionFromPath('/api/v1')).toBe('v1');
    expect(versionFromPath('/api/health')).toBeNull();
  });

  it('neznámá verze končí 422 unsupported_api_version', () => {
    try {
      assertVersionSupported('v9');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('unsupported_api_version');
      expect(err.status).toBe(422);
    }
  });

  it('aktivní verze nemá hlavičky Deprecation ani Sunset', () => {
    expect(deprecationHeaders('v1')).toEqual({});
  });

  it('deprecated verze nese Deprecation a Sunset v RFC 1123', () => {
    const headers = deprecationHeaders('v1', {
      v1: { phase: 'deprecated', sunsetAt: new Date('2027-08-01T00:00:00.000Z') },
    });
    expect(headers['Deprecation']).toBe('true');
    expect(headers['Sunset']).toBe('Sun, 01 Aug 2027 00:00:00 GMT');
  });

  it('verze po sunsetu končí 410 endpoint_removed', () => {
    try {
      assertVersionSupported('v1', {
        v1: { phase: 'sunset', sunsetAt: new Date('2020-01-01T00:00:00.000Z') },
      });
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('endpoint_removed');
      expect(err.status).toBe(410);
    }
  });
});
