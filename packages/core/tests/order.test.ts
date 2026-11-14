import { describe, it, expect } from 'vitest';
import {
  moveItem, moveUp, moveDown, canMoveUp, canMoveDown, insertItem, removeItem, undoRemove,
  restoreOrder, orderOf, withPositions, changedPositions,
} from '../src/index.js';

const L = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (l: { id: string }[]) => l.map((x) => x.id).join('');

describe('hand order (zodal#127)', () => {
  it('moves the first, last and only item', () => {
    expect(ids(moveUp(L, 'a'))).toBe('abcd');
    expect(ids(moveDown(L, 'a'))).toBe('bacd');
    expect(ids(moveDown(L, 'd'))).toBe('abcd');
    expect(ids(moveUp(L, 'd'))).toBe('abdc');
    const only = [{ id: 'x' }];
    expect(ids(moveUp(only, 'x'))).toBe('x');
    expect(ids(moveDown(only, 'x'))).toBe('x');
    expect(canMoveUp(only, 'x')).toBe(false);
    expect(canMoveDown(only, 'x')).toBe(false);
  });
  it('moveItem clamps, ignores unknown ids, and never changes its input', () => {
    expect(ids(moveItem(L, 'a', 99))).toBe('bcda');
    expect(ids(moveItem(L, 'd', -5))).toBe('dabc');
    expect(ids(moveItem(L, 'zz', 0))).toBe('abcd');
    expect(ids(L)).toBe('abcd');
  });
  it('can* says which buttons to disable', () => {
    expect([canMoveUp(L, 'a'), canMoveDown(L, 'a'), canMoveUp(L, 'd'), canMoveDown(L, 'd')]).toEqual([false, true, true, false]);
    expect(canMoveUp(L, 'zz')).toBe(false);
  });
  it('remove returns what and where, and Undo puts it back', () => {
    const r = removeItem(L, 'c');
    expect([ids(r.list), r.removed?.id, r.index]).toEqual(['abd', 'c', 2]);
    expect(ids(undoRemove(r.list, r))).toBe('abcd');
    expect(removeItem(L, 'zz').index).toBe(-1);
    expect(() => insertItem(L, { id: 'a' })).toThrow(/already/);
    expect(ids(insertItem(L, { id: 'e' }, 1))).toBe('aebcd');
  });
  it('restores an original order, keeping new items after it', () => {
    const original = orderOf(L);
    const shuffled = [{ id: 'd' }, { id: 'new' }, { id: 'b' }, { id: 'a' }, { id: 'c' }];
    expect(ids(restoreOrder(shuffled, original))).toBe('abcdnew');
  });
  it('writes positions, and lists only the items whose position changed', () => {
    const before = withPositions(L.map((x) => ({ ...x })));
    expect(before.map((x) => x.position)).toEqual([0, 1, 2, 3]);
    const after = withPositions(moveDown(before, 'b'));
    expect(changedPositions(before, after)).toEqual([{ id: 'c', position: 1 }, { id: 'b', position: 2 }]);
  });
});
