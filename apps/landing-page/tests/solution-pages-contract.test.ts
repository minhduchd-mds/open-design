import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { LANDING_LOCALES, type LandingLocaleCode } from '../app/i18n.ts';
import { getSolutionPageCopy, type SolutionPageKey } from '../app/solution-pages-i18n.ts';

const root = resolve(import.meta.dirname, '..');

const TOOL_PAGES: ReadonlyArray<{
  key: SolutionPageKey;
  slug: string;
  hero: string;
}> = [
  { key: 'aiWireframeGenerator', slug: 'ai-wireframe-generator', hero: 'ai-wireframe-generator-hero.webp' },
  { key: 'aiUiGenerator', slug: 'ai-ui-generator', hero: 'ai-ui-generator-hero.webp' },
  { key: 'aiPrototypeGenerator', slug: 'ai-prototype-generator', hero: 'ai-prototype-generator-hero.webp' },
  { key: 'aiLandingPageGenerator', slug: 'ai-landing-page-generator', hero: 'ai-landing-page-generator-hero.webp' },
  { key: 'designToCode', slug: 'design-to-code', hero: 'design-to-code-hero.webp' },
  { key: 'figmaToCode', slug: 'figma-to-code', hero: 'figma-to-code-hero.webp' },
  { key: 'screenshotToCode', slug: 'screenshot-to-code', hero: 'screenshot-to-code-hero.webp' },
];

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('solution tool pages contract', () => {
  it('keeps tool pages registered in the header and solutions hub', () => {
    const header = read('app/_components/header.tsx');
    const hub = read('app/pages/solutions/index.astro');

    for (const page of TOOL_PAGES) {
      const href = `/solutions/${page.slug}/`;
      assert.match(header, new RegExp(`href:\\s*['"]${href}['"]`), `${page.slug} missing from header tools menu`);
      assert.match(header, new RegExp(`key:\\s*['"]${page.key}['"]`), `${page.key} missing from header tools menu`);
      assert.match(hub, new RegExp(`key:\\s*['"]${page.key}['"]`), `${page.key} missing from solutions hub`);
      assert.match(hub, new RegExp(`slug:\\s*['"]${page.slug}['"]`), `${page.slug} missing from solutions hub`);
    }
  });

  it('publishes concrete root and localized routes for every tool page', () => {
    for (const page of TOOL_PAGES) {
      const rootPage = read(`app/pages/solutions/${page.slug}/index.astro`);
      assert.match(rootPage, new RegExp(`getSolutionPageCopy\\(locale, ['"]${page.key}['"]\\)`));
      assert.match(rootPage, new RegExp(`/solutions/${page.hero}`));

      const localizedPage = read(`app/pages/[locale]/solutions/${page.slug}/index.astro`);
      assert.match(localizedPage, /getStaticPaths/);
      assert.match(localizedPage, new RegExp(`solutions/${page.slug}/index\\.astro`));

      const heroPath = resolve(root, `public/solutions/${page.hero}`);
      assert.ok(statSync(heroPath).size > 10_000, `${page.hero} should be a real hero asset`);
    }
  });

  it('resolves non-empty localized copy for every tool page', () => {
    const locales = LANDING_LOCALES.map((locale) => locale.code as LandingLocaleCode);

    for (const locale of locales) {
      for (const page of TOOL_PAGES) {
        const copy = getSolutionPageCopy(locale, page.key);
        assert.ok(copy.title.trim(), `${locale}/${page.key} title missing`);
        assert.ok(copy.description.trim(), `${locale}/${page.key} description missing`);
        assert.ok(copy.breadcrumb.trim(), `${locale}/${page.key} breadcrumb missing`);
        assert.ok(copy.heading.trim(), `${locale}/${page.key} heading missing`);
        assert.ok(copy.heroImageAlt.trim(), `${locale}/${page.key} hero alt missing`);
        assert.ok(copy.steps.length >= 3, `${locale}/${page.key} should describe at least three steps`);
        assert.ok(copy.features.length >= 3, `${locale}/${page.key} should describe at least three features`);
        assert.ok(copy.faq.length >= 3, `${locale}/${page.key} should include FAQ content`);
      }
    }
  });
});
