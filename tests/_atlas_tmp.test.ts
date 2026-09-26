import { test } from 'vitest';
import { atlasUsage, regionNames, region } from '../src/render/models/atlas';
test('atlas', () => { console.log('usage', atlasUsage(), regionNames().length, JSON.stringify(region('glowAmber'))); });
