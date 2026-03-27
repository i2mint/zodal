import { story, given, when, then } from '../executors/dsl.js';

export const zeroConfigCollection = story('Zero-config collection with sensible defaults', {
  given: [
    given.schema('Project', {
      id: 'string.uuid',
      name: 'string.min(1).max(200)',
      status: 'enum:draft,active,archived',
      priority: 'number.int.min(1).max(5)',
      tags: 'array:string',
      description: 'string.optional',
      createdAt: 'date',
      updatedAt: 'date',
    }),
  ],
  when: [
    when.defineCollection(),
  ],
  then: [
    then.fieldCount(8),
    then.idFieldIs('id'),
    then.labelFieldIs('name'),
    // String inference
    then.fieldIs('name', { sortable: 'both', searchable: true, summaryField: true }),
    // Enum inference
    then.fieldIs('status', { filterable: 'select', groupable: true }),
    // Number inference
    then.fieldIs('priority', { filterable: 'range', aggregatable: ['sum', 'avg', 'min', 'max'] }),
    // ID inference
    then.fieldIs('id', { editable: false, visible: false }),
    // Timestamp inference
    then.fieldIs('createdAt', { editable: false, sortable: 'both' }),
    then.fieldIs('updatedAt', { editable: false, visible: false }),
    // Visibility
    then.visibleFieldsExclude('id', 'updatedAt'),
    then.visibleFieldsInclude('name', 'status', 'priority'),
    // Defaults
    then.affordanceIs('create', true),
    then.affordanceIs('read', true),
    then.affordanceIs('update', true),
    then.affordanceIs('delete', true),
  ],
});

export const configuredCollection = story('Collection with explicit config overrides', {
  given: [
    given.schema('User', {
      id: 'string',
      email: 'string',
      displayName: 'string',
      role: 'enum:admin,editor,viewer',
      isActive: 'boolean',
      password: 'string',
    }),
    given.config('userConfig', {
      affordances: { bulkDelete: true, create: false },
      fields: {
        displayName: { inlineEditable: true },
        role: { filterable: 'multiSelect' },
      },
      operations: [
        { name: 'deactivate', label: 'Deactivate', scope: 'item' },
      ],
    }),
  ],
  when: [
    when.defineCollection('User', 'userConfig'),
  ],
  then: [
    then.idFieldIs('id'),
    then.affordanceIs('bulkDelete', true),
    then.affordanceIs('create', false),
    then.fieldIs('displayName', { inlineEditable: true }),
    then.fieldIs('role', { filterable: 'multiSelect' }),
    then.fieldIs('password', { readable: false, visible: false }),
    then.operationCount('item', 1),
  ],
});
