import { describe, it } from 'vitest';
import { runStory } from '../executors/dsl.js';
import { zeroConfigCollection, configuredCollection } from './zero-config.story.js';

describe('Story: Zero-config collection', () => {
  it(zeroConfigCollection.name, () => {
    runStory(zeroConfigCollection);
  });
});

describe('Story: Configured collection', () => {
  it(configuredCollection.name, () => {
    runStory(configuredCollection);
  });
});
