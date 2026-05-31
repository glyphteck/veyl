function cleanIds(ids) {
    return (ids || []).filter(Boolean);
}

function uniqueIds(ids) {
    return new Set(ids).size === ids.length;
}

function sameIdSet(previous, next) {
    if (previous.length !== next.length) {
        return false;
    }
    const ids = new Set(previous);
    return next.every((id) => ids.has(id));
}

export function sameListIds(previousIds, nextIds) {
    const previous = cleanIds(previousIds);
    const next = cleanIds(nextIds);
    return previous.length === next.length && previous.every((id, index) => next[index] === id);
}

export function getMovedRowBatch(previousIds, nextIds) {
    const previous = cleanIds(previousIds);
    const next = cleanIds(nextIds);
    if (previous.length !== next.length || previous.length < 2 || sameListIds(previous, next)) {
        return null;
    }
    if (!uniqueIds(previous) || !uniqueIds(next) || !sameIdSet(previous, next)) {
        return null;
    }

    const previousIndexById = new Map(previous.map((id, index) => [id, index]));
    const nextIndexById = new Map(next.map((id, index) => [id, index]));
    const ids = next.filter((id) => nextIndexById.get(id) < previousIndexById.get(id));
    if (!ids.length) {
        return null;
    }

    return {
        ids,
        moves: ids.map((id) => ({
            id,
            previousIndex: previousIndexById.get(id),
            nextIndex: nextIndexById.get(id),
        })),
    };
}

export function getInsertedRowBatch(previousIds, nextIds) {
    const previous = cleanIds(previousIds);
    const next = cleanIds(nextIds);
    if (previous.length < 1 || next.length < 1 || sameListIds(previous, next) || !uniqueIds(next)) {
        return null;
    }

    const previousSet = new Set(previous);
    const ids = next.filter((id) => !previousSet.has(id));
    if (!ids.length) {
        return null;
    }

    const retainedNext = next.filter((id) => previousSet.has(id));
    const retainedPrevious = previous.slice(0, retainedNext.length);
    if (!retainedNext.every((id, index) => retainedPrevious[index] === id)) {
        return null;
    }

    return {
        ids,
        inserts: ids.map((id) => ({
            id,
            nextIndex: next.indexOf(id),
        })),
    };
}
