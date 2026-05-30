'use client';

import { useEffect, useRef } from 'react';
import { dijkstraRouting } from './dijkstra';
import { randomWalkRouting } from './randomwalk';

const NODE_INITIAL_POINTS = 10;
const NODE_MIN_POINTS_TO_RECEIVE_NEW_PATHS = 6;
const NODE_MIN_POINTS_TO_STAY_ALIVE = 4;
const NODE_MIN_POINTS_TO_SEND = 8;
const NODE_POINTS_DECAY_MIN_PER_SECOND = 1;
const NODE_POINTS_DECAY_EXPONENT = 0.08;
const NODE_POINTS_PER_PING = 1;
const NODE_POINTS_PER_SENT_PING = 1;
const NODE_POINTS_ANIMATION_MS = 320;
const NODE_SCREEN_AREA_RATIO = 0.0001;
const NODE_PADDING = 32;
const NODE_MIN_SPAWN_DISTANCE = 32;
const NODE_SPAWN_ATTEMPTS_PER_TICK = 12;
const NODE_SPAWN_INTERVAL_MS = 160;
const INITIAL_PING_DELAY_MAX = 2200;
const PING_INTERVAL_MIN = 2800;
const PING_INTERVAL_MAX = 7000;
const PING_LIKELIHOOD_EXPONENT = 0.0275;
const EXTRA_PING_CHANCE = 0.04;
const MAX_ACTIVE_PINGS_PER_NODE = 5;
const PING_TRAVEL_TIME_PER_NODE = 640;
const PING_FADE_MS = 640;
const PATH_LINE_WIDTH = 3;
const PATH_ALPHA = 0.2;
const PAYLOAD_RADIUS = 4;
const PAYLOAD_ALPHA = 1;
const FULLSCREEN_NODE_FADE_MS = 1280;

const ROUTING_ALGORITHM_WEIGHTS = [
    { routing: dijkstraRouting, weight: 0.5 },
    { routing: randomWalkRouting, weight: 0.5 },
];

function nodeCountForSize(width, height) {
    return Math.round(width * height * NODE_SCREEN_AREA_RATIO);
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function easeOutCubic(value) {
    return 1 - (1 - value) ** 3;
}

function displayedPoints(node, now) {
    if (!node) return 0;
    const elapsed = Math.max(0, Math.min(1, (now - node.pointsAnimationStartedAt) / NODE_POINTS_ANIMATION_MS));
    return node.pointsFrom + (node.points - node.pointsFrom) * easeOutCubic(elapsed);
}

function nodeRadius(node, now) {
    return Math.max(0, displayedPoints(node, now));
}

function isLiveNode(node) {
    return !!node && !node.dead && node.points > 0;
}

function canSendPing(node) {
    return isLiveNode(node) && node.points >= NODE_MIN_POINTS_TO_SEND;
}

function canReceiveNewPath(node) {
    return isLiveNode(node) && node.points > NODE_MIN_POINTS_TO_RECEIVE_NEW_PATHS;
}

function liveNodeCount(nodes) {
    return nodes.reduce((total, node) => total + (isLiveNode(node) ? 1 : 0), 0);
}

function maxActivePings(nodes) {
    return Math.round(liveNodeCount(nodes) * MAX_ACTIVE_PINGS_PER_NODE);
}

function travelingPingCount(pings) {
    return pings.reduce((total, ping) => total + (ping.fadeStartedAt == null ? 1 : 0), 0);
}

function pingLikelihood(node) {
    return Math.exp(Math.max(0, node.points) * PING_LIKELIHOOD_EXPONENT);
}

function nextPingDelay(node) {
    return randomBetween(PING_INTERVAL_MIN, PING_INTERVAL_MAX) / pingLikelihood(node);
}

function extraPingChance(node) {
    return EXTRA_PING_CHANCE * pingLikelihood(node);
}

function pointsDecayPerSecond(node) {
    return Math.max(NODE_POINTS_DECAY_MIN_PER_SECOND, Math.exp(node.points * NODE_POINTS_DECAY_EXPONENT) - 1);
}

function currentColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || 'oklch(0.6 0 0)';
}

function chooseRoutingAlgorithm() {
    const total = ROUTING_ALGORITHM_WEIGHTS.reduce((sum, item) => sum + item.weight, 0);
    let pick = Math.random() * total;

    for (const item of ROUTING_ALGORITHM_WEIGHTS) {
        pick -= item.weight;
        if (pick <= 0) return item.routing;
    }

    return ROUTING_ALGORITHM_WEIGHTS[0].routing;
}

function connect(adjacency, nodes, a, b, maxEdgeDistance) {
    if (a === b || adjacency[a].has(b)) return;

    const start = nodes[a];
    const end = nodes[b];
    const weight = Math.hypot(end.x - start.x, end.y - start.y);
    if (weight > maxEdgeDistance) return;

    adjacency[a].set(b, weight);
    adjacency[b].set(a, weight);
}

function createNode(id, point, now) {
    return {
        id,
        x: point.x,
        y: point.y,
        points: NODE_INITIAL_POINTS,
        pointsFrom: 0,
        pointsAnimationStartedAt: now,
        lastDecayAt: now,
        nextPingAt: now + Math.random() * INITIAL_PING_DELAY_MAX,
        pingPasses: 0,
        activePingPasses: 0,
        lastPingAt: 0,
        dead: false,
    };
}

function findSpawnPoint(nodes, width, height, now) {
    for (let attempt = 0; attempt < NODE_SPAWN_ATTEMPTS_PER_TICK; attempt += 1) {
        const candidate = {
            x: NODE_PADDING + Math.random() * Math.max(1, width - NODE_PADDING * 2),
            y: NODE_PADDING + Math.random() * Math.max(1, height - NODE_PADDING * 2),
        };
        const spaced = nodes.every((node) => {
            const radius = nodeRadius(node, now);
            if (!node || radius <= 0.5) return true;
            const distance = Math.hypot(node.x - candidate.x, node.y - candidate.y);
            return distance >= NODE_MIN_SPAWN_DISTANCE + radius + NODE_INITIAL_POINTS;
        });

        if (spaced) return candidate;
    }

    return null;
}

function nearestLiveNodes(liveNodes, current, count) {
    const nearest = [];

    liveNodes.forEach((other) => {
        if (other.index === current.index) return;

        const item = {
            index: other.index,
            distance: Math.hypot(other.node.x - current.node.x, other.node.y - current.node.y),
        };
        const insertAt = nearest.findIndex((near) => item.distance < near.distance);
        const targetIndex = insertAt < 0 ? nearest.length : insertAt;

        if (nearest.length < count || targetIndex < count) {
            nearest.splice(targetIndex, 0, item);
            if (nearest.length > count) nearest.length = count;
        }
    });

    return nearest;
}

function buildGraph(nodes, maxEdgeDistance) {
    const adjacency = Array.from({ length: nodes.length }, () => new Map());
    const liveNodes = nodes.map((node, index) => ({ node, index })).filter(({ node }) => canReceiveNewPath(node));
    const neighborCount = Math.max(3, Math.min(7, Math.round(liveNodes.length / 18)));

    liveNodes.forEach(({ node, index }) => {
        const nearest = nearestLiveNodes(liveNodes, { node, index }, neighborCount);

        nearest.forEach((other) => connect(adjacency, nodes, index, other.index, maxEdgeDistance));

        if (liveNodes.length - 1 > nearest.length && Math.random() > 0.45) {
            const nearestIndexes = new Set(nearest.map((other) => other.index));
            const farNodes = liveNodes.filter((other) => other.index !== index && !nearestIndexes.has(other.index));
            const farNode = farNodes[Math.floor(Math.random() * farNodes.length)];
            if (farNode) connect(adjacency, nodes, index, farNode.index, maxEdgeDistance);
        }
    });

    liveNodes
        .map(({ node, index }) => ({ index, x: node.x }))
        .sort((a, b) => a.x - b.x)
        .forEach((node, index, ordered) => {
            if (index > 0) connect(adjacency, nodes, node.index, ordered[index - 1].index, maxEdgeDistance);
        });

    return adjacency.map((edges) => Array.from(edges, ([node, weight]) => ({ node, weight })));
}

function pingUsesNode(ping, nodeIndex) {
    return ping.path.includes(nodeIndex) || ping.route?.includes(nodeIndex);
}

export function Graph({ className = 'pointer-events-none absolute inset-0 h-full w-full' }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return undefined;

        let frame = null;
        let nodes = [];
        let graph = [];
        let activePings = [];
        let width = 0;
        let height = 0;
        let targetNodeCount = 0;
        let nextNodeSpawnAt = 0;
        let fullscreenNode = null;
        let graphDirty = true;
        let color = currentColor();
        const routing = chooseRoutingAlgorithm();
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        function resetGraph(now) {
            nodes = [];
            graph = [];
            activePings = [];
            fullscreenNode = null;
            targetNodeCount = nodeCountForSize(width, height);
            nextNodeSpawnAt = now;
            graphDirty = true;
        }

        function resize() {
            const rect = canvas.getBoundingClientRect();
            const nextWidth = Math.max(1, rect.width || window.innerWidth - 24);
            const nextHeight = Math.max(1, rect.height || window.innerHeight - 24);
            const dpr = Math.min(window.devicePixelRatio || 1, 2);

            if (nextWidth === width && nextHeight === height) return;

            width = nextWidth;
            height = nextHeight;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            color = currentColor();
            resetGraph(performance.now());
        }

        function setNodePoints(node, nextPoints, now) {
            const wasPathable = canReceiveNewPath(node);
            node.pointsFrom = displayedPoints(node, now);
            const points = Math.max(0, nextPoints);
            node.points = points <= NODE_MIN_POINTS_TO_STAY_ALIVE ? 0 : points;
            node.pointsAnimationStartedAt = now;
            node.lastDecayAt = now;
            const isPathable = canReceiveNewPath(node);
            if (wasPathable !== isPathable) {
                graphDirty = true;
            }
            if (!node.dead && node.points <= 0) {
                node.dead = true;
                node.nextPingAt = Infinity;
                nextNodeSpawnAt = Math.min(nextNodeSpawnAt, now);
                graphDirty = true;
            }
        }

        function decayNodes(now) {
            nodes.forEach((node) => {
                if (!isLiveNode(node)) return;

                const elapsedSeconds = Math.max(0, now - node.lastDecayAt) / 1000;
                if (elapsedSeconds <= 0) return;

                setNodePoints(node, node.points - elapsedSeconds * pointsDecayPerSecond(node), now);
            });
        }

        function spawnNodeAt(index, now) {
            const point = findSpawnPoint(nodes, width, height, now);
            if (!point) return false;

            nodes[index] = createNode(index, point, now);
            graphDirty = true;
            return true;
        }

        function activePingReferences(nodeIndex) {
            return activePings.some((ping) => pingUsesNode(ping, nodeIndex));
        }

        function reusableNodeIndex(now) {
            return nodes.findIndex((node, index) => node?.dead && !activePingReferences(index) && displayedPoints(node, now) <= 0.5);
        }

        function nextNodeIndex(now) {
            const reusable = reusableNodeIndex(now);
            return reusable >= 0 ? reusable : nodes.length;
        }

        function scheduleNodeSpawns(now) {
            if (now < nextNodeSpawnAt) return;

            if (liveNodeCount(nodes) >= targetNodeCount) return;

            spawnNodeAt(nextNodeIndex(now), now);
            nextNodeSpawnAt = now + NODE_SPAWN_INTERVAL_MS;
        }

        function fillNodes(now) {
            let guard = 0;
            while (liveNodeCount(nodes) < targetNodeCount && guard < targetNodeCount * 2) {
                if (!spawnNodeAt(nextNodeIndex(now), now)) break;
                guard += 1;
            }
        }

        function rebuildGraphIfNeeded() {
            if (!graphDirty) return;
            graph = buildGraph(nodes, routing.maxEdgeDistance);
            graphDirty = false;
        }

        function routeContext(now) {
            return {
                nodes,
                graph,
                width,
                height,
                now,
                canReceiveNewPath,
            };
        }

        function setPingFade(ping, now, head = null) {
            if (ping.fadeStartedAt != null) return;

            const node = nodes[ping.currentNode];
            ping.fadeStartedAt = now;
            ping.fadeHead = head || (node ? { x: node.x, y: node.y } : null);
            ping.nextNode = null;
        }

        function markPingNode(ping, nodeIndex, now, type) {
            const node = nodes[nodeIndex];
            if (!node || ping.passedNodes.has(`${type}:${nodeIndex}`)) return;

            node.pingPasses += 1;
            if (type === 'source') {
                setNodePoints(node, node.points - NODE_POINTS_PER_SENT_PING, now);
            } else if (isLiveNode(node)) {
                setNodePoints(node, node.points + NODE_POINTS_PER_PING, now);
            }
            node.activePingPasses += 1;
            node.lastPingAt = now;
            ping.passedNodes.add(`${type}:${nodeIndex}`);
        }

        function startNextHop(ping, now) {
            if (!canReceiveNewPath(nodes[ping.currentNode])) {
                setPingFade(ping, now);
                return false;
            }

            if (!routing.startHop(ping, routeContext(now))) {
                setPingFade(ping, now);
                return false;
            }

            return true;
        }

        function spawnPing(source, now) {
            if (travelingPingCount(activePings) >= maxActivePings(nodes)) return;
            if (!canSendPing(nodes[source]) || liveNodeCount(nodes) < 2) return;

            const ping = routing.createPing({ source, ...routeContext(now) });
            if (!ping) return;

            if (!startNextHop(ping, now)) return;

            markPingNode(ping, source, now, 'source');
            activePings.push(ping);
        }

        function schedulePings(now) {
            nodes.forEach((node, index) => {
                if (!canSendPing(node) || now < node.nextPingAt) return;

                spawnPing(index, now);
                if (Math.random() < extraPingChance(node)) spawnPing(index, now + 1);
                node.nextPingAt = now + nextPingDelay(node);
            });
        }

        function pingHead(ping, hopProgress) {
            const start = nodes[ping.currentNode];
            const end = nodes[ping.nextNode];
            if (!start || !end) return ping.fadeHead || (start ? { x: start.x, y: start.y } : null);

            return {
                x: start.x + (end.x - start.x) * hopProgress,
                y: start.y + (end.y - start.y) * hopProgress,
            };
        }

        function drawPingPath(ping, head, alpha) {
            if (!head || !nodes[ping.path[0]]) return;

            const lastCompletePathIndex = ping.fadeStartedAt == null ? Math.max(0, ping.path.length - 2) : ping.path.length - 1;
            context.globalAlpha = PATH_ALPHA * alpha;
            context.lineWidth = PATH_LINE_WIDTH;
            context.beginPath();
            context.moveTo(nodes[ping.path[0]].x, nodes[ping.path[0]].y);

            for (let pathIndex = 1; pathIndex <= lastCompletePathIndex; pathIndex += 1) {
                const node = nodes[ping.path[pathIndex]];
                if (node) context.lineTo(node.x, node.y);
            }

            context.lineTo(head.x, head.y);
            context.stroke();

            context.globalAlpha = PAYLOAD_ALPHA * alpha;
            context.beginPath();
            context.arc(head.x, head.y, PAYLOAD_RADIUS, 0, Math.PI * 2);
            context.fill();
        }

        function finishHop(ping, now) {
            const arrivedNode = ping.nextNode;
            markPingNode(ping, arrivedNode, now, 'arrival');
            ping.currentNode = arrivedNode;
            ping.nextNode = null;

            if (!routing.canContinue(ping, routeContext(now))) {
                setPingFade(ping, now, nodes[arrivedNode] ? { x: nodes[arrivedNode].x, y: nodes[arrivedNode].y } : null);
                return;
            }

            startNextHop(ping, now);
        }

        function drawFadingRoute(ping, now) {
            const fadeProgress = Math.max(0, Math.min(1, (now - ping.fadeStartedAt) / PING_FADE_MS));
            const fadeAlpha = 1 - fadeProgress;
            if (fadeAlpha <= 0) return false;

            drawPingPath(ping, ping.fadeHead, fadeAlpha);
            return true;
        }

        function drawRoute(ping, now) {
            if (ping.fadeStartedAt != null) return drawFadingRoute(ping, now);

            if (ping.nextNode == null && !startNextHop(ping, now)) {
                return drawFadingRoute(ping, now);
            }

            const hopProgress = Math.max(0, Math.min(1, (now - ping.hopStartedAt) / PING_TRAVEL_TIME_PER_NODE));
            const head = pingHead(ping, hopProgress);
            if (!head) return false;

            drawPingPath(ping, head, 1);

            if (hopProgress >= 1) {
                finishHop(ping, now);
            }

            return true;
        }

        function drawNodes(now) {
            nodes.forEach((node) => {
                const radius = nodeRadius(node, now);
                if (radius <= 0.25) return;

                context.globalAlpha = 1;
                context.beginPath();
                context.arc(node.x, node.y, radius, 0, Math.PI * 2);
                context.fill();
            });
        }

        function fullscreenRadius() {
            return Math.max(width, height) / 2;
        }

        function triggerFullscreenNode(now) {
            if (fullscreenNode) return true;

            const threshold = fullscreenRadius() * 1.3;
            const node = nodes.find((candidate) => nodeRadius(candidate, now) >= threshold);
            if (!node) return false;

            fullscreenNode = {
                x: node.x,
                y: node.y,
                radius: Math.max(threshold, nodeRadius(node, now)),
                fadeStartedAt: now,
            };
            activePings = [];
            graph = [];
            graphDirty = false;
            return true;
        }

        function drawFullscreenNode(now) {
            if (!fullscreenNode) return false;

            const fadeProgress = Math.max(0, Math.min(1, (now - fullscreenNode.fadeStartedAt) / FULLSCREEN_NODE_FADE_MS));
            const alpha = 1 - fadeProgress;

            if (alpha <= 0) {
                resetGraph(now);
                return true;
            }

            context.globalAlpha = alpha;
            context.beginPath();
            context.arc(fullscreenNode.x, fullscreenNode.y, fullscreenNode.radius, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = 1;
            return true;
        }

        function requestNextFrame() {
            if (!reduceMotion) {
                frame = requestAnimationFrame(draw);
            }
        }

        function draw(time = 0) {
            const now = reduceMotion ? performance.now() : time;
            context.clearRect(0, 0, width, height);
            context.strokeStyle = color;
            context.fillStyle = color;
            context.lineCap = 'round';
            context.lineJoin = 'round';

            if (fullscreenNode) {
                drawFullscreenNode(now);
                requestNextFrame();
                return;
            }

            if (!reduceMotion) {
                scheduleNodeSpawns(now);
                decayNodes(now);
                rebuildGraphIfNeeded();
                schedulePings(now);
            }

            nodes.forEach((node) => {
                node.activePingPasses = 0;
            });

            activePings = activePings.filter((ping) => drawRoute(ping, now));

            if (triggerFullscreenNode(now)) {
                context.clearRect(0, 0, width, height);
                drawFullscreenNode(now);
                requestNextFrame();
                return;
            }

            drawNodes(now);

            context.globalAlpha = 1;
            requestNextFrame();
        }

        function start() {
            if (frame) {
                cancelAnimationFrame(frame);
                frame = null;
            }
            if (reduceMotion) {
                fillNodes(performance.now());
                rebuildGraphIfNeeded();
                draw();
                return;
            }
            frame = requestAnimationFrame(draw);
        }

        resize();
        start();

        const observer = new ResizeObserver(() => {
            resize();
            if (reduceMotion) {
                fillNodes(performance.now());
                rebuildGraphIfNeeded();
                draw();
            }
        });
        observer.observe(canvas);

        return () => {
            observer.disconnect();
            if (frame) {
                cancelAnimationFrame(frame);
            }
        };
    }, []);

    return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
