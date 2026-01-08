/**
 * Tournament API Authentication Integration Tests
 * 
 * Tests that tournament endpoints properly require authentication
 * and reject unauthorized requests.
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = 'http://localhost:5000';

async function fetchJSON(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

describe('Tournament API Authentication', () => {
  describe('GET /api/evolution-tournaments', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await fetchJSON('/api/evolution-tournaments');
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/evolution-tournaments/:id', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await fetchJSON('/api/evolution-tournaments/test-id-123');
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/evolution-tournaments/:id/entries', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await fetchJSON('/api/evolution-tournaments/test-id-123/entries');
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/evolution-tournaments/run', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await fetchJSON('/api/evolution-tournaments/run', {
        method: 'POST',
        body: JSON.stringify({ cadence: 'INCREMENTAL' }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/bots/live-eligible', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await fetchJSON('/api/bots/live-eligible');
      expect(response.status).toBe(401);
    });
  });
});
