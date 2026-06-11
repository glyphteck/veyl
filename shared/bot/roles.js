import { BOT_ECHO_USERNAME, BOT_FAUCET_USERNAME, BOT_REVIEW_USERNAME } from './events.js';
import { lowerText, sameText } from '../utils/text.js';

export const BOT_ROLE_TRAFFIC = 'traffic';
export const BOT_ROLE_ECHO = 'echo';
export const BOT_ROLE_REVIEW = 'review';
export const BOT_ROLES = Object.freeze([BOT_ROLE_TRAFFIC, BOT_ROLE_ECHO, BOT_ROLE_REVIEW]);

export function cleanBotRole(value) {
    const role = lowerText(value);
    return BOT_ROLES.includes(role) ? role : '';
}

export function botRoles(roles = {}) {
    const next = {};
    for (const role of BOT_ROLES) {
        next[role] = roles?.[role] === true;
    }
    return next;
}

export function botRolePatch(role, enabled) {
    const name = cleanBotRole(role);
    if (!name) {
        throw new Error(`unknown bot role: ${role}`);
    }
    return { roles: { [name]: enabled === true } };
}

export function hasBotRole(value, role) {
    const name = cleanBotRole(role);
    return !!name && value?.roles?.[name] === true;
}

export function hasBotTrafficRole(value) {
    return hasBotRole(value, BOT_ROLE_TRAFFIC);
}

export function hasBotEchoRole(value) {
    return hasBotRole(value, BOT_ROLE_ECHO);
}

export function hasBotReviewRole(value) {
    return hasBotRole(value, BOT_ROLE_REVIEW);
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

export function defaultBotRoles(username) {
    return botRoles({
        [BOT_ROLE_TRAFFIC]: isDefaultTrafficBotUsername(username),
        [BOT_ROLE_ECHO]: isDefaultEchoBotUsername(username),
        [BOT_ROLE_REVIEW]: sameText(username, BOT_REVIEW_USERNAME),
    });
}
