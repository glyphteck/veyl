const RANDOM_WALK_MIN_STEPS = 4;
const RANDOM_WALK_MAX_STEPS = 12;
const RANDOM_WALK_MAX_EDGE_DISTANCE = 180;

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function randomInt(min, max) {
    return Math.floor(randomBetween(min, max + 1));
}

function nextHopTarget(ping, { nodes, graph, canReceiveNewPath }) {
    const previous = ping.path.length > 1 ? ping.path[ping.path.length - 2] : null;
    const options = (graph[ping.currentNode] || []).filter((edge) => canReceiveNewPath(nodes[edge.node]) && edge.weight <= RANDOM_WALK_MAX_EDGE_DISTANCE);
    const forwardOptions = options.filter((edge) => edge.node !== previous);
    const choices = forwardOptions.length ? forwardOptions : options;
    if (!choices.length) return -1;

    return choices[Math.floor(Math.random() * choices.length)].node;
}

export const randomWalkRouting = {
    key: 'random-walk',
    maxEdgeDistance: RANDOM_WALK_MAX_EDGE_DISTANCE,

    createPing({ source, now }) {
        return {
            id: `${source}-${now}-${Math.random()}`,
            path: [source],
            source,
            currentNode: source,
            nextNode: null,
            hopStartedAt: now,
            stepsRemaining: randomInt(RANDOM_WALK_MIN_STEPS, RANDOM_WALK_MAX_STEPS),
            passedNodes: new Set(),
            fadeStartedAt: null,
            fadeHead: null,
        };
    },

    startHop(ping, context) {
        if (ping.stepsRemaining <= 0) return false;

        const nextNode = nextHopTarget(ping, context);
        if (nextNode < 0) return false;

        ping.nextNode = nextNode;
        ping.path.push(nextNode);
        ping.hopStartedAt = context.now;
        ping.stepsRemaining -= 1;
        return true;
    },

    canContinue(ping, { nodes, canReceiveNewPath }) {
        return ping.stepsRemaining > 0 && canReceiveNewPath(nodes[ping.currentNode]);
    },
};
