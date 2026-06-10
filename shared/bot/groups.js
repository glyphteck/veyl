import { BOT_ECHO_USERNAME, BOT_FAUCET_USERNAME, BOT_REVIEW_USERNAME } from './events.js';
import { lowerText, sameText } from '../utils/text.js';

export const BOT_GROUP_TRAFFIC = 'traffic';
export const BOT_GROUP_ECHO = 'echo';
export const BOT_GROUPS = Object.freeze([BOT_GROUP_TRAFFIC, BOT_GROUP_ECHO]);

export const BOT_BEHAVIOR_REVIEW = 'review';
export const BOT_BEHAVIORS = Object.freeze([BOT_BEHAVIOR_REVIEW]);

export function cleanBotGroup(value) {
    const group = lowerText(value);
    return BOT_GROUPS.includes(group) ? group : '';
}

export function cleanBotBehavior(value) {
    const behavior = lowerText(value);
    return BOT_BEHAVIORS.includes(behavior) ? behavior : '';
}

export function botGroups(groups = {}) {
    const next = {};
    for (const group of BOT_GROUPS) {
        next[group] = groups?.[group] === true;
    }
    return next;
}

export function botBehaviors(behaviors = {}) {
    const next = {};
    for (const behavior of BOT_BEHAVIORS) {
        next[behavior] = behaviors?.[behavior] === true;
    }
    return next;
}

export function botGroupPatch(group, enabled) {
    const name = cleanBotGroup(group);
    if (!name) {
        throw new Error(`unknown bot group: ${group}`);
    }
    return { groups: { [name]: enabled === true } };
}

export function botBehaviorPatch(behavior, enabled) {
    const name = cleanBotBehavior(behavior);
    if (!name) {
        throw new Error(`unknown bot behavior: ${behavior}`);
    }
    return { behaviors: { [name]: enabled === true } };
}

export function hasBotGroup(value, group) {
    const name = cleanBotGroup(group);
    return !!name && value?.groups?.[name] === true;
}

export function hasBotBehavior(value, behavior) {
    const name = cleanBotBehavior(behavior);
    return !!name && value?.behaviors?.[name] === true;
}

export function hasBotTrafficGroup(value) {
    return hasBotGroup(value, BOT_GROUP_TRAFFIC);
}

export function hasBotEchoGroup(value) {
    return sameText(value?.username, BOT_ECHO_USERNAME) || hasBotGroup(value, BOT_GROUP_ECHO);
}

export function hasBotReviewBehavior(value) {
    return sameText(value?.username, BOT_REVIEW_USERNAME) || hasBotBehavior(value, BOT_BEHAVIOR_REVIEW);
}

export function isCanonicalBotUsername(username) {
    return [BOT_FAUCET_USERNAME, BOT_ECHO_USERNAME, BOT_REVIEW_USERNAME].some((name) => sameText(username, name));
}

export function isDefaultTrafficBotUsername(username) {
    return !isCanonicalBotUsername(username);
}

export function isDefaultEchoBotUsername(username) {
    return sameText(username, BOT_ECHO_USERNAME) || sameText(username, BOT_REVIEW_USERNAME) || isDefaultTrafficBotUsername(username);
}

export function defaultBotGroups(username) {
    return botGroups({
        [BOT_GROUP_TRAFFIC]: isDefaultTrafficBotUsername(username),
        [BOT_GROUP_ECHO]: isDefaultEchoBotUsername(username),
    });
}

export function defaultBotBehaviors(username) {
    return botBehaviors({
        [BOT_BEHAVIOR_REVIEW]: sameText(username, BOT_REVIEW_USERNAME),
    });
}
