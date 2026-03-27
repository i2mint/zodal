/**
 * BDD Stories: explain() — inference transparency
 */
import { story, given, when, then, type StoryStep, type StoryContext } from '../executors/dsl.js';

// Custom then steps for explain()
const thenExplain = {
  /** Assert that explain() returns traces for a field */
  hasTraceFor(fieldName: string, affordance: string): StoryStep {
    return (ctx: StoryContext) => {
      const collection = Object.values(ctx.collections).at(-1)!;
      const traces = collection.explain(fieldName);
      const match = traces.find(t => t.affordance === affordance);
      if (!match) {
        throw new Error(`No trace found for ${fieldName}.${affordance}`);
      }
    };
  },

  /** Assert that a specific layer appears in the trace */
  hasLayer(fieldName: string, affordance: string, layer: string): StoryStep {
    return (ctx: StoryContext) => {
      const collection = Object.values(ctx.collections).at(-1)!;
      const traces = collection.explain(fieldName);
      const match = traces.find(t => t.affordance === affordance);
      if (!match) throw new Error(`No trace for ${fieldName}.${affordance}`);
      const hasLayer = match.layers.some(l => l.layer === layer);
      if (!hasLayer) {
        throw new Error(`No '${layer}' layer in trace for ${fieldName}.${affordance}. Layers: ${match.layers.map(l => l.layer).join(', ')}`);
      }
    };
  },

  /** Assert the final value of a traced affordance */
  traceFinalValue(fieldName: string, affordance: string, expected: unknown): StoryStep {
    return (ctx: StoryContext) => {
      const collection = Object.values(ctx.collections).at(-1)!;
      const traces = collection.explain(fieldName);
      const match = traces.find(t => t.affordance === affordance);
      if (!match) throw new Error(`No trace for ${fieldName}.${affordance}`);
      if (match.finalValue !== expected) {
        throw new Error(`Expected finalValue ${expected}, got ${match.finalValue}`);
      }
    };
  },
};

export const explainBasicInference = story('explain() shows type-based inference', {
  given: [
    given.schema('Simple', {
      id: 'string',
      name: 'string',
      count: 'number',
      isActive: 'boolean',
    }),
  ],
  when: [
    when.defineCollection(),
  ],
  then: [
    thenExplain.hasTraceFor('name', 'sortable'),
    thenExplain.hasLayer('name', 'sortable', 'type'),
    thenExplain.traceFinalValue('name', 'sortable', 'both'),
    thenExplain.hasTraceFor('count', 'filterable'),
    thenExplain.traceFinalValue('count', 'filterable', 'range'),
    thenExplain.hasTraceFor('isActive', 'groupable'),
    thenExplain.traceFinalValue('isActive', 'groupable', true),
  ],
});

export const explainNameHeuristics = story('explain() shows name heuristic overrides', {
  given: [
    given.schema('WithPassword', {
      id: 'string',
      password: 'string',
      email: 'string',
      description: 'string',
    }),
  ],
  when: [
    when.defineCollection(),
  ],
  then: [
    // password: name heuristic overrides type defaults
    thenExplain.hasLayer('password', 'visible', 'name'),
    thenExplain.traceFinalValue('password', 'visible', false),
    // email: name heuristic adds email widget
    thenExplain.hasTraceFor('email', 'editWidget'),
    thenExplain.hasLayer('email', 'editWidget', 'name'),
    // description: name heuristic sets sortable to false
    thenExplain.hasLayer('description', 'sortable', 'name'),
    thenExplain.traceFinalValue('description', 'sortable', false),
  ],
});

export const explainConfigOverride = story('explain() shows config overrides winning', {
  given: [
    given.schema('Overridden', {
      name: 'string',
    }),
    given.config('override', {
      fields: { name: { sortable: false } },
    }),
  ],
  when: [
    when.defineCollection('Overridden', 'override'),
  ],
  then: [
    thenExplain.hasLayer('name', 'sortable', 'config'),
    thenExplain.traceFinalValue('name', 'sortable', false),
  ],
});
