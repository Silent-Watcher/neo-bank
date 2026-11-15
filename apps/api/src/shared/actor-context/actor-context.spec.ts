import { describe, expect, it } from 'vitest';

import { getActorContext, getActorId, runWithActorContext } from './actor-context.js';

describe('actor context (AsyncLocalStorage)', () => {
  it('resolves no actor outside any context', () => {
    // Act & Assert
    expect(getActorId()).toBeNull();
    expect(getActorContext()).toBeUndefined();
  });

  it('resolves the actor inside an open context', () => {
    // Act & Assert
    runWithActorContext({ actorId: '42' }, () => {
      expect(getActorId()).toBe('42');
      expect(getActorContext()).toEqual({ actorId: '42' });
    });
    expect(getActorId()).toBeNull();
  });

  it('treats an anonymous actor as the system', () => {
    // Act & Assert
    runWithActorContext({ actorId: null }, () => {
      expect(getActorId()).toBeNull();
    });
  });

  it('shadows the outer actor inside a nested context', () => {
    // Act & Assert
    runWithActorContext({ actorId: 'outer' }, () => {
      expect(getActorId()).toBe('outer');
      runWithActorContext({ actorId: 'inner' }, () => {
        expect(getActorId()).toBe('inner');
      });
      expect(getActorId()).toBe('outer');
    });
  });

  it('keeps concurrent async chains isolated from each other', async () => {
    // Arrange — two interleaved chains, each inside its own actor context.
    const ticks = (n: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, n));

    // Act
    const [first, second] = await Promise.all([
      runWithActorContext({ actorId: '9007199254740991' }, async () => {
        await ticks(5);
        const seen = [getActorId()];
        await ticks(5);
        seen.push(getActorId());
        return seen;
      }),
      runWithActorContext({ actorId: '9007199254740992' }, async () => {
        await ticks(7);
        const seen = [getActorId()];
        await ticks(7);
        seen.push(getActorId());
        return seen;
      }),
    ]);

    // Assert — every read inside a chain saw only its own actor.
    expect(first).toEqual(['9007199254740991', '9007199254740991']);
    expect(second).toEqual(['9007199254740992', '9007199254740992']);
  });
});
