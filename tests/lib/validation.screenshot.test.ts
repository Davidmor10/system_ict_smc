import { describe, expect, it } from 'vitest';
import { screenshotSchema } from '../../app/lib/validation';

// A screenshot is only ever produced client-side by FileReader.readAsDataURL
// on a File the user picked — so the accepted shape should be exactly what
// that API emits for the raster types the upload input is meant to carry.
// `data:image/` alone also matched image/svg+xml, and an inline SVG can carry
// its own <script>/event-handler payload — not a type this field has any
// reason to accept.
describe('screenshotSchema', () => {
  it.each(['png', 'jpeg', 'webp', 'gif'])('accepts a %s data URL', (type) => {
    expect(screenshotSchema.safeParse(`data:image/${type};base64,AAAA`).success).toBe(true);
  });

  it('rejects an SVG data URL', () => {
    expect(screenshotSchema.safeParse('data:image/svg+xml;base64,AAAA').success).toBe(false);
  });

  it('rejects a non-base64 data URL', () => {
    expect(screenshotSchema.safeParse('data:image/png,AAAA').success).toBe(false);
  });

  it('rejects a non-image data URL', () => {
    expect(screenshotSchema.safeParse('data:text/html;base64,AAAA').success).toBe(false);
  });

  it('rejects a plain string with no data: prefix', () => {
    expect(screenshotSchema.safeParse('not-a-data-url').success).toBe(false);
  });
});
