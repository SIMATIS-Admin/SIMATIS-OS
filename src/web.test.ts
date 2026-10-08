import { describe, expect, it } from 'vitest';
import { cacheControlFor } from './web.js';

describe('cacheControlFor', () => {
  it('always revalidates the page, so an update shows at once', () => {
    expect(cacheControlFor('/app/dist/web/index.html')).toBe('no-cache');
  });

  it('caches hashed assets for good', () => {
    expect(cacheControlFor('/app/dist/web/assets/index-BMMtTej1.js')).toMatch(/immutable/);
  });
});
