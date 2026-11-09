import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerOriginGuard } from './origin-guard.js';

describe('origin guard', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registerOriginGuard(app);
    app.get('/lire', () => ({ ok: true }));
    app.post('/ecrire', () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['localhost:4300', '127.0.0.1:4300', '127.0.0.1:3000', '[::1]:4300', 'localhost'])(
    'serves the local host %s',
    async (host) => {
      const response = await app.inject({ method: 'GET', url: '/lire', headers: { host } });
      expect(response.statusCode).toBe(200);
    },
  );

  it.each(['evil.example:4300', 'localhost.evil.example', '127.0.0.1.nip.io:4300'])(
    'refuses a foreign host %s (DNS rebinding)',
    async (host) => {
      const response = await app.inject({ method: 'GET', url: '/lire', headers: { host } });
      expect(response.statusCode).toBe(403);
    },
  );

  it('accepts a write from the OS itself or from a client without Origin', async () => {
    for (const headers of [
      { host: '127.0.0.1:4300', origin: 'http://127.0.0.1:4300', 'sec-fetch-site': 'same-origin' },
      // Vite dev server, which proxies /api.
      { host: 'localhost:5173', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' },
      { host: '127.0.0.1:4300' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/ecrire', headers });
      expect(response.statusCode).toBe(200);
    }
  });

  it('refuses a write coming from another site (CSRF)', async () => {
    for (const headers of [
      { host: '127.0.0.1:4300', origin: 'https://evil.example' },
      { host: '127.0.0.1:4300', origin: 'null' },
      { host: '127.0.0.1:4300', 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/ecrire', headers });
      expect(response.statusCode).toBe(403);
    }
  });

  it('keeps cross-site reads open, for the OAuth redirect', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/lire',
      headers: { host: '127.0.0.1:4300', 'sec-fetch-site': 'cross-site' },
    });
    expect(response.statusCode).toBe(200);
  });
});
