#!/usr/bin/env bun

import admin, { db, FieldValue, Timestamp } from '../../functions/lib/admin.js';
import { cliArgs, resolveUid } from './common.mjs';

function usage() {
    console.error('usage: bun ban <uid|@username> [chat|avatar] [hours|permanent|clear]');
    process.exit(1);
}

function parseFeature(value) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();

    if (!raw || raw === 'chat') {
        return 'chat';
    }

    if (raw === 'avatar') {
        return 'avatar';
    }

    return null;
}

function parseCooldown(value) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();

    if (!raw || ['perm', 'perma', 'permanent', 'forever'].includes(raw)) {
        return null;
    }

    if (['clear', 'off', 'none', 'unban'].includes(raw)) {
        return 'clear';
    }

    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error('cooldown must be a positive hour count, permanent, or clear');
    }

    return hours;
}

async function setBan(uid, feature, cooldown) {
    const ref = db.collection('moderation').doc(uid);

    if (cooldown === 'clear') {
        await ref.set(
            {
                banned: {
                    [feature]: FieldValue.delete(),
                },
            },
            { merge: true }
        );
        return { until: null, cleared: true };
    }

    const until = typeof cooldown === 'number' ? Timestamp.fromMillis(Date.now() + cooldown * 60 * 60 * 1000) : null;
    await ref.set(
        {
            banned: {
                [feature]: { until },
            },
        },
        { merge: true }
    );

    if (feature === 'avatar') {
        await admin
            .storage()
            .bucket()
            .file(`${uid}/avatar.webp`)
            .delete({ ignoreNotFound: true });
    }

    return { until, cleared: false };
}

async function main() {
    const [userArg, featureOrCooldownArg, cooldownArg] = cliArgs();
    if (!userArg) {
        usage();
    }

    const parsedFeature = parseFeature(featureOrCooldownArg);
    const feature = parsedFeature || 'chat';
    const cooldown = parseCooldown(parsedFeature ? cooldownArg : featureOrCooldownArg);
    const { uid, username } = await resolveUid(userArg);
    const result = await setBan(uid, feature, cooldown);

    if (result.cleared) {
        console.log(`cleared ${feature} ban for ${username ? `@${username}` : uid} (${uid})`);
        return;
    }

    if (result.until == null) {
        console.log(`set permanent ${feature} ban for ${username ? `@${username}` : uid} (${uid})`);
        return;
    }

    console.log(`set ${feature} ban for ${username ? `@${username}` : uid} (${uid}) until ${result.until.toDate().toISOString()}`);
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});
