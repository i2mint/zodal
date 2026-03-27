/**
 * Filter Expression Utilities.
 *
 * Evaluates structured FilterExpression objects against items for client-side filtering.
 */

import type { FilterExpression, FilterCondition } from '@zodal/core';

/**
 * Compile a FilterExpression into a predicate function for client-side evaluation.
 */
export function filterToFunction<T extends Record<string, any>>(
  filter: FilterExpression,
): (item: T) => boolean {
  // Compound: AND
  if ('and' in filter) {
    const predicates = filter.and.map(filterToFunction<T>);
    return (item) => predicates.every((p) => p(item));
  }

  // Compound: OR
  if ('or' in filter) {
    const predicates = filter.or.map(filterToFunction<T>);
    return (item) => predicates.some((p) => p(item));
  }

  // Compound: NOT
  if ('not' in filter) {
    const predicate = filterToFunction<T>(filter.not);
    return (item) => !predicate(item);
  }

  // Leaf: FilterCondition
  return evaluateCondition(filter as FilterCondition);
}

function evaluateCondition<T extends Record<string, any>>(
  condition: FilterCondition,
): (item: T) => boolean {
  const { field, operator, value } = condition;

  return (item: T) => {
    const fieldValue = item[field];

    switch (operator) {
      // Equality
      case 'eq':
        return fieldValue === value;
      case 'ne':
        return fieldValue !== value;

      // Comparison
      case 'gt':
        return fieldValue > (value as number);
      case 'gte':
        return fieldValue >= (value as number);
      case 'lt':
        return fieldValue < (value as number);
      case 'lte':
        return fieldValue <= (value as number);

      // String
      case 'contains':
        return typeof fieldValue === 'string' && typeof value === 'string'
          ? fieldValue.toLowerCase().includes(value.toLowerCase())
          : false;
      case 'startsWith':
        return typeof fieldValue === 'string' && typeof value === 'string'
          ? fieldValue.toLowerCase().startsWith(value.toLowerCase())
          : false;
      case 'endsWith':
        return typeof fieldValue === 'string' && typeof value === 'string'
          ? fieldValue.toLowerCase().endsWith(value.toLowerCase())
          : false;

      // Set
      case 'in':
        return Array.isArray(value) ? value.includes(fieldValue) : false;
      case 'notIn':
        return Array.isArray(value) ? !value.includes(fieldValue) : true;

      // Array
      case 'arrayContains':
        return Array.isArray(fieldValue) ? fieldValue.includes(value) : false;
      case 'arrayContainsAny':
        return Array.isArray(fieldValue) && Array.isArray(value)
          ? value.some((v) => fieldValue.includes(v))
          : false;

      // Existence
      case 'isNull':
        return fieldValue == null;
      case 'isNotNull':
        return fieldValue != null;

      default:
        return true;
    }
  };
}
