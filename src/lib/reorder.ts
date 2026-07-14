export function moveItemBefore<T extends { id: string }>(
  items: readonly T[],
  movingId: string,
  targetId: string,
): T[] {
  if (movingId === targetId) return [...items];

  const moving = items.find((item) => item.id === movingId);
  if (!moving || !items.some((item) => item.id === targetId)) {
    return [...items];
  }

  const withoutMoving = items.filter((item) => item.id !== movingId);
  const targetIndex = withoutMoving.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return [...items];

  return [
    ...withoutMoving.slice(0, targetIndex),
    moving,
    ...withoutMoving.slice(targetIndex),
  ];
}

export function moveItemAfter<T extends { id: string }>(
  items: readonly T[],
  movingId: string,
  targetId: string,
): T[] {
  if (movingId === targetId) return [...items];

  const moving = items.find((item) => item.id === movingId);
  if (!moving || !items.some((item) => item.id === targetId)) {
    return [...items];
  }

  const withoutMoving = items.filter((item) => item.id !== movingId);
  const targetIndex = withoutMoving.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return [...items];

  return [
    ...withoutMoving.slice(0, targetIndex + 1),
    moving,
    ...withoutMoving.slice(targetIndex + 1),
  ];
}

export function moveItemByOffset<T extends { id: string }>(
  items: readonly T[],
  id: string,
  offset: -1 | 1,
): T[] {
  const index = items.findIndex((item) => item.id === id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
    return [...items];
  }

  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function moveProviderGroupByOffset<T extends { provider: string }>(
  items: readonly T[],
  provider: string,
  offset: -1 | 1,
): T[] {
  const groupOrder: string[] = [];
  for (const item of items) {
    if (!groupOrder.includes(item.provider)) groupOrder.push(item.provider);
  }

  const index = groupOrder.indexOf(provider);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= groupOrder.length) {
    return [...items];
  }

  const nextGroupOrder = [...groupOrder];
  const [movingProvider] = nextGroupOrder.splice(index, 1);
  nextGroupOrder.splice(nextIndex, 0, movingProvider);

  return nextGroupOrder.flatMap((groupProvider) =>
    items.filter((item) => item.provider === groupProvider),
  );
}

export function moveItemWithinGroupByOffset<
  T extends { id: string; provider: string },
>(items: readonly T[], id: string, offset: -1 | 1): T[] {
  const item = items.find((entry) => entry.id === id);
  if (!item) return [...items];

  const group = items.filter((entry) => entry.provider === item.provider);
  const groupIndex = group.findIndex((entry) => entry.id === id);
  const nextGroupIndex = groupIndex + offset;
  if (
    groupIndex < 0 ||
    nextGroupIndex < 0 ||
    nextGroupIndex >= group.length
  ) {
    return [...items];
  }

  const nextGroup = moveItemByOffset(group, id, offset);
  let nextGroupOffset = 0;
  return items.map((entry) => {
    if (entry.provider !== item.provider) return entry;
    return nextGroup[nextGroupOffset++];
  });
}

export function isCompleteIdOrder(
  proposedIds: readonly string[],
  existingIds: readonly string[],
): boolean {
  if (proposedIds.length !== existingIds.length) return false;
  const existing = new Set(existingIds);
  if (existing.size !== existingIds.length) return false;
  const proposed = new Set(proposedIds);
  if (proposed.size !== proposedIds.length) return false;
  return proposedIds.every((id) => existing.has(id));
}
