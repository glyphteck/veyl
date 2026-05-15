// Shared command definitions and parser used across web, iOS, and chat inputs.

const COMMAND_SETS = {
    mainmenu: [
        {
            name: 'send',
            syntax: '/send @[username] [amount]',
            args: ['username', 'amount'],
        },
        {
            name: 'request',
            aliases: ['req'],
            syntax: '/request @[username] [amount]',
            args: ['username', 'amount'],
        },
        {
            name: 'msg',
            syntax: '/msg @[username] [message]',
            args: ['username', 'message'],
        },
    ],
    chat: [
        {
            name: 'send',
            syntax: '/send [amount]',
            args: ['amount'],
        },
        {
            name: 'request',
            aliases: ['req'],
            syntax: '/request [amount]',
            args: ['amount'],
        },
    ],
};

function getCommands(mode = 'mainmenu') {
    return COMMAND_SETS[mode] || COMMAND_SETS.mainmenu;
}

function resolveCommand(name, mode = 'mainmenu') {
    const value = String(name ?? '').trim().toLowerCase();
    if (!value) {
        return null;
    }
    return (
        getCommands(mode).find((cmd) => {
            if (cmd.name === value) {
                return true;
            }
            return Array.isArray(cmd.aliases) && cmd.aliases.includes(value);
        }) || null
    );
}

// Returns the partial username being typed (after @) in a command, or null if not at that step.
// Does NOT trim — a trailing space means the user moved past the current token.
// '/send @'      → ''       (browse all users)
// '/send @ali'   → 'ali'    (filtering users)
// '/send @alice '→ null     (username done, typing next arg)
// '/send'        → null     (not at username step yet)
export function getTypingUsername(input, { mode = 'mainmenu' } = {}) {
    const raw = String(input ?? '');
    if (!raw.startsWith('/') || raw.endsWith(' ')) return null;
    const tokens = raw.trim().slice(1).split(/\s+/);
    if (tokens.length !== 2) return null;
    const name = tokens[0];
    const cmd = resolveCommand(name, mode);
    if (!cmd || !cmd.args.includes('username')) return null;
    const userToken = tokens[1];
    if (!userToken.startsWith('@')) return null;
    return userToken.slice(1);
}

// Returns commands whose name starts with the typed command token.
// Input can be '/', '/s', '/send', '/send @alice 100' — only the first token is matched.
export function matchCommands(input, { mode = 'mainmenu' } = {}) {
    const raw = String(input ?? '').trim();
    if (!raw.startsWith('/')) return [];
    const namePart = raw.slice(1).split(/\s+/)[0].toLowerCase();
    const commands = getCommands(mode);
    if (!namePart) return commands;
    return commands.filter((cmd) => cmd.name.startsWith(namePart) || cmd.aliases?.some((alias) => alias.startsWith(namePart)));
}

// Parses a command string into structured data.
// Returns null if the input is not a command string or the command is unknown.
// Returns { name, args: { username?, amount?, message? }, complete }
export function parseCommand(input, { mode = 'mainmenu' } = {}) {
    const raw = String(input ?? '').trim();
    if (!raw.startsWith('/')) return null;

    const tokens = raw.slice(1).trim().split(/\s+/);
    const commandToken = tokens[0]?.toLowerCase();
    if (!commandToken) return { name: null, args: {}, complete: false };

    const cmd = resolveCommand(commandToken, mode);
    if (!cmd) return null;

    const args = {};
    let idx = 1;

    if (cmd.args.includes('username')) {
        const t = tokens[idx++];
        if (t) args.username = t.startsWith('@') ? t.slice(1) : t;
    }
    if (cmd.args.includes('amount')) {
        const t = tokens[idx++];
        if (t) args.amount = t;
    }
    if (cmd.args.includes('message')) {
        const rest = tokens.slice(idx);
        if (rest.length) args.message = rest.join(' ');
    }

    const complete = cmd.args.every((a) => args[a]);
    return { name: cmd.name, args, complete };
}

export function getCommandHints(input, { mode = 'mainmenu' } = {}) {
    const raw = String(input ?? '');
    if (!raw.startsWith('/')) {
        return [];
    }

    const matched = matchCommands(raw, { mode });
    if (!matched.length) {
        return [];
    }

    if (raw.trim() === '/') {
        return matched.map((cmd) => `/${cmd.name}`);
    }

    if (matched.length === 1) {
        return [matched[0].syntax];
    }

    return matched.map((cmd) => `/${cmd.name}`);
}

export function getCommandContext(input, { mode = 'mainmenu' } = {}) {
    const raw = String(input ?? '');
    if (!raw.startsWith('/')) {
        return { kind: 'none', items: [] };
    }

    const matched = matchCommands(raw, { mode });
    if (!matched.length) {
        return { kind: 'none', items: [] };
    }

    if (raw.trim() === '/') {
        return {
            kind: 'pick',
            items: matched.map((cmd) => `/${cmd.name}`),
        };
    }

    if (matched.length === 1) {
        return {
            kind: 'syntax',
            items: [matched[0].syntax],
        };
    }

    return {
        kind: 'pick',
        items: matched.map((cmd) => `/${cmd.name}`),
    };
}
