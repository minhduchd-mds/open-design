import { describe, expect, it } from 'vitest';
import {
  formatVisualInspirationContext,
  rankVisualInspirations,
  visualInspirationSearchSeed,
  type VisualInspirationCandidate,
} from '../../src/runtime/visual-inspiration';

const candidates: VisualInspirationCandidate[] = [
  {
    id: 'portfolio-deck',
    source: 'template',
    title: 'Modern Portfolio Slide Deck',
    description: 'A presentation deck for design portfolio case studies.',
    prompt: 'Create a portfolio presentation for a product designer.',
    tags: ['deck', 'portfolio', 'presentation'],
    surface: 'deck',
    mode: 'deck',
    platform: null,
    scenario: 'design',
    featured: 3,
    previewUrl: '/api/skills/portfolio-deck/example',
    previewKind: 'html',
  },
  {
    id: 'mobile-wireframe',
    source: 'community',
    title: 'Wireframe mobile flow',
    description: 'Low fidelity mobile app screens.',
    prompt: 'Create a mobile checkout flow.',
    tags: ['mobile', 'wireframe'],
    surface: 'mobile',
    mode: 'prototype',
    platform: 'mobile',
    scenario: 'product',
    previewUrl: '/api/plugins/mobile-wireframe/example/index',
    previewKind: 'html',
  },
];

describe('visual inspiration matching', () => {
  it('expands Chinese intent terms into matching template examples', () => {
    const ranked = rankVisualInspirations(candidates, '生成一个设计作品集 PPT');
    expect(ranked[0]?.id).toBe('portfolio-deck');
    expect(ranked[0]?.matchedTerms).toEqual(expect.arrayContaining(['portfolio', 'deck']));
  });

  it('boosts the active template while preserving semantic matches', () => {
    const ranked = rankVisualInspirations(candidates, 'visual reference', {
      currentSkillId: 'portfolio-deck',
    });
    expect(ranked[0]?.id).toBe('portfolio-deck');
  });

  it('formats selected inspiration context after form answers', () => {
    const context = formatVisualInspirationContext(candidates[0]!, {
      selectedHeader: '[visual inspiration - selected]',
      skippedHeader: '[visual inspiration - skipped]',
      selectedLabel: 'Selected example',
      sourceLabel: 'Source',
      tagsLabel: 'Matched tags',
      promptLabel: 'Example prompt',
      previewLabel: 'Preview',
      notesLabel: 'User notes',
      instruction: 'Use this as visual reference.',
      skippedBody: 'No example was selected.',
      templateSource: 'Templates',
      communitySource: 'Community',
    }, 'Borrow the sparse cover and tight type scale.');
    expect(context).toContain('[visual inspiration - selected]');
    expect(context).toContain('Modern Portfolio Slide Deck');
    expect(context).toContain('Borrow the sparse cover');
  });

  it('builds a compact search seed from form answers', () => {
    expect(visualInspirationSearchSeed([
      '[form answers - discovery]',
      '- What are we making?: Slide deck / pitch',
      '- Anything else?: (skipped)',
    ].join('\n'))).toBe('What are we making?: Slide deck / pitch');
  });
});
