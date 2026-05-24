const DIJKSTRA_MAX_EDGE_DISTANCE = 180;
const DIJKSTRA_FAR_TARGET_POOL_RATIO = 0.35;
const DIJKSTRA_MIN_TARGET_DISTANCE_RATIO = 0.35;

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function shuffle(items) {
    const copy = [...items];

    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }

    return copy;
}

function shortestPath(graph, source, target) {
    const distanceByNode = new Array(graph.length).fill(Infinity);
    const previousByNode = new Array(graph.length).fill(-1);
    const unvisited = new Set(graph.map((_, index) => index));

    distanceByNode[source] = 0;

    while (unvisited.size) {
        let closest = -1;
        let closestDistance = Infinity;

        unvisited.forEach((node) => {
            if (distanceByNode[node] < closestDistance) {
                closest = node;
                closestDistance = distanceByNode[node];
            }
        });

        if (closest < 0 || closestDistance === Infinity) break;
        if (closest === target) break;

        unvisited.delete(closest);

        (graph[closest] || []).forEach((edge) => {
            if (!unvisited.has(edge.node)) return;

            const nextDistance = distanceByNode[closest] + edge.weight;
            if (nextDistance >= distanceByNode[edge.node]) return;

            distanceByNode[edge.node] = nextDistance;
            previousByNode[edge.node] = closest;
        });
    }

    if (source !== target && previousByNode[target] < 0) return null;

    const path = [];
    for (let node = target; node >= 0; node = previousByNode[node]) {
        path.unshift(node);
        if (node === source) break;
    }

    return path[0] === source ? path : null;
}

function farTargets(source, { nodes, width, height, canReceiveNewPath }) {
    const sourceNode = nodes[source];
    const minDistance = Math.min(width, height) * DIJKSTRA_MIN_TARGET_DISTANCE_RATIO;
    const targets = nodes
        .map((node, index) => ({
            index,
            distance: node && sourceNode ? distance(sourceNode, node) : 0,
        }))
        .filter((target) => target.index !== source && target.distance > 0 && canReceiveNewPath(nodes[target.index]))
        .sort((a, b) => b.distance - a.distance);

    const farEnough = targets.filter((target) => target.distance >= minDistance);
    const pool = farEnough.length ? farEnough : targets;
    const poolSize = Math.max(1, Math.ceil(pool.length * DIJKSTRA_FAR_TARGET_POOL_RATIO));
    const farPool = pool.slice(0, poolSize);
    const farPoolIndexes = new Set(farPool.map((target) => target.index));
    const fallbackPool = targets.filter((target) => !farPoolIndexes.has(target.index));
    return [...shuffle(farPool), ...shuffle(fallbackPool)];
}

function routeToFarTarget(source, context) {
    const targets = farTargets(source, context);

    for (const target of targets) {
        const route = shortestPath(context.graph, source, target.index);
        if (route?.length > 1) return route;
    }

    return null;
}

export const dijkstraRouting = {
    key: 'dijkstra',
    maxEdgeDistance: DIJKSTRA_MAX_EDGE_DISTANCE,

    createPing({ source, now, ...context }) {
        const route = routeToFarTarget(source, context);
        if (!route) return null;

        return {
            id: `${source}-${now}-${Math.random()}`,
            path: [source],
            route,
            routeIndex: 0,
            source,
            currentNode: source,
            nextNode: null,
            hopStartedAt: now,
            passedNodes: new Set(),
            fadeStartedAt: null,
            fadeHead: null,
        };
    },

    startHop(ping, { now, nodes }) {
        const nextNode = ping.route?.[ping.routeIndex + 1];
        if (nextNode == null || !nodes[nextNode]) return false;

        ping.routeIndex += 1;
        ping.nextNode = nextNode;
        ping.path.push(nextNode);
        ping.hopStartedAt = now;
        return true;
    },

    canContinue(ping, { nodes, canReceiveNewPath }) {
        return ping.routeIndex < ping.route.length - 1 && canReceiveNewPath(nodes[ping.currentNode]);
    },
};
