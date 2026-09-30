import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Instrument Rails UI contract', () => {
  it('names each gameplay information rail explicitly', () => {
    expect(read('src/ui/hud.ts')).toContain('pn-rail--economy');
    expect(read('src/ui/hud.ts')).toContain('pn-rail--mission');
    expect(read('src/ui/hud.ts')).toContain('pn-rail--player');
    expect(read('src/ui/hotbar.ts')).toContain('pn-rail--tools');
    expect(read('src/ui/buildHud.ts')).toContain('pn-rail--build');
    expect(read('src/ui/tooltip.ts')).toContain('pn-rail--machine');
  });

  it('contains the approved responsive and reduced-motion contracts', () => {
    const css = read('src/ui/styles.css');
    expect(css).toContain('.pn-rail--economy');
    expect(css).toContain('.pn-rail--mission');
    expect(css).toContain('.pn-rail--player');
    expect(css).toContain('@media (max-height: 720px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
