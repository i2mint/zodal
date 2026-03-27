import { describe, it } from 'vitest';
import { runStory } from '../executors/dsl.js';
import {
  explainBasicInference,
  explainNameHeuristics,
  explainConfigOverride,
} from './explain.story.js';

describe('Story: explain() inference transparency', () => {
  it(explainBasicInference.name, () => runStory(explainBasicInference));
  it(explainNameHeuristics.name, () => runStory(explainNameHeuristics));
  it(explainConfigOverride.name, () => runStory(explainConfigOverride));
});
