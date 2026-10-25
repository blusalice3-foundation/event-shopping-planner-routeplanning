/**
 * Private captured JSON snapshots supply the same deep-freeze provenance in
 * both partitions. Geometry growth does not resize the ordinary/item registry.
 * Object.isFrozen alone never supplies evidence, including for shared aliases.
 */
export function createPrivateSnapshotFreezer() {
  const ordinary = new WeakSet<object>();
  const geometry = new WeakSet<object>();
  const has = (value: object): boolean =>
    ordinary.has(value) || geometry.has(value);
  const isObject = (value: unknown): value is object =>
    value !== null && typeof value === "object";

  function freezeGraph(root: object, destination: WeakSet<object>): void {
    if (has(root)) return;
    const visited = new WeakSet<object>();
    const completed: object[] = [];
    const visit = (value: unknown): void => {
      if (!isObject(value) || has(value) || visited.has(value)) return;
      visited.add(value);
      for (const child of Object.values(value)) visit(child);
      Object.freeze(value);
      completed.push(value);
    };
    visit(root);
    // A completed child can still point to a parent whose freeze later throws.
    // Publish new private witnesses only after this whole graph completed.
    for (const value of completed) destination.add(value);
  }

  return {
    has,
    freeze(snapshot: object): void {
      if (has(snapshot)) return;
      const maps = (snapshot as { mapData?: unknown }).mapData;
      if (isObject(maps))
        for (const eventMaps of Object.values(maps)) {
          if (!isObject(eventMaps)) continue;
          for (const map of Object.values(eventMaps))
            if (isObject(map)) freezeGraph(map, geometry);
        }
      // Both partitions carry identical private deep-freeze evidence. An item
      // aliased from geometry can retain that witness for order-only capture.
      freezeGraph(snapshot, ordinary);
    },
  };
}
