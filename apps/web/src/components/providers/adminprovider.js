'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { resolveNetwork } from '@veyl/shared/network';
import { banState } from '@veyl/shared/moderation';
import { cleanText, lowerText } from '@veyl/shared/utils/text';
import { timestampMs } from '@veyl/shared/utils/time';
import { resolveWalletPK } from '@veyl/shared/wallet/keys';
import { cloud } from '@/lib/cloud';
import { usePeer } from '@/components/providers/peerprovider';
import { useUser } from '@/components/providers/userprovider';
import { sortBots } from '@/lib/admin/bots';
import { parseReportEvidence, reportCount, sortOffenders } from '@/lib/admin/reports';

const AdminContext = createContext(null);
const WALLET_NETWORK = resolveNetwork({ NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK });

export function AdminProvider({ children }) {
    const user = useUser();
    const { findPeer, primePeer } = usePeer();
    const [offendersRaw, setOffendersRaw] = useState([]);
    const [offendersReady, setOffendersReady] = useState(false);
    const [detailsRaw, setDetailsRaw] = useState({});
    const [moderationRaw, setModerationRaw] = useState({});
    const [botsRaw, setBotsRaw] = useState([]);
    const [botsReady, setBotsReady] = useState(false);
    const [botDetailsRaw, setBotDetailsRaw] = useState({});
    const [runtimeRunning, setRuntimeRunning] = useState(false);
    const detailUnsubsRef = useRef(new Map());
    const moderationUnsubsRef = useRef(new Map());
    const botDetailUnsubsRef = useRef(new Map());
    const botEventUnsubsRef = useRef(new Map());

    const clearDetails = useCallback(() => {
        for (const unsubscribe of detailUnsubsRef.current.values()) {
            unsubscribe?.();
        }
        detailUnsubsRef.current.clear();
        setDetailsRaw({});
    }, []);

    const clearBotDetails = useCallback(() => {
        for (const unsubscribe of botDetailUnsubsRef.current.values()) {
            unsubscribe?.();
        }
        botDetailUnsubsRef.current.clear();

        for (const unsubscribe of botEventUnsubsRef.current.values()) {
            unsubscribe?.();
        }
        botEventUnsubsRef.current.clear();
        setBotDetailsRaw({});
    }, []);

    const clearModeration = useCallback(() => {
        for (const unsubscribe of moderationUnsubsRef.current.values()) {
            unsubscribe?.();
        }
        moderationUnsubsRef.current.clear();
        setModerationRaw({});
    }, []);

    useEffect(() => {
        return () => {
            clearDetails();
            clearBotDetails();
            clearModeration();
        };
    }, [clearBotDetails, clearDetails, clearModeration]);

    useEffect(() => {
        if (!user.isAdmin) {
            setRuntimeRunning(false);
            return;
        }

        const unsubscribe = cloud.admin.bots.watchRuntime(
            (running) => setRuntimeRunning(running === true),
            (error) => {
                console.warn('failed to subscribe runtime status', error);
                setRuntimeRunning(false);
            }
        );

        return () => unsubscribe();
    }, [user.isAdmin]);

    useEffect(() => {
        if (!user.adminReady) {
            return;
        }

        if (!user.isAdmin) {
            setOffendersRaw([]);
            setOffendersReady(false);
            clearDetails();
            clearModeration();
            return;
        }

        setOffendersReady(false);

        const unsubscribe = cloud.admin.reports.watchOffenders(
            (records = []) => {
                const rows = sortOffenders(
                    records.map((record) => ({
                        uid: cleanText(record?.uid || record?.id),
                        count: reportCount(record?.count),
                        lastReportAt: record?.lastReportAt || null,
                    }))
                );

                setOffendersRaw(rows);
                setOffendersReady(true);
                rows.forEach((row) => {
                    void primePeer({ uid: row.uid });
                });
            },
            (error) => {
                console.warn('failed to subscribe offenders', error);
                setOffendersRaw([]);
                setOffendersReady(true);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [clearDetails, clearModeration, primePeer, user.adminReady, user.isAdmin]);

    useEffect(() => {
        if (!user.adminReady) {
            return;
        }

        if (!user.isAdmin) {
            setBotsRaw([]);
            setBotsReady(false);
            clearBotDetails();
            return;
        }

        setBotsReady(false);

        const unsubscribe = cloud.admin.bots.watch(
            (records = []) => {
                const rows = sortBots(
                    records.map((record) => ({
                        ...record,
                        id: cleanText(record?.id),
                    }))
                );

                setBotsRaw(rows);
                setBotsReady(true);
                rows.forEach((row) => {
                    if (row?.id) {
                        void primePeer({ uid: row.id });
                    }
                });
            },
            (error) => {
                console.warn('failed to subscribe bots', error);
                setBotsRaw([]);
                setBotsReady(true);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [clearBotDetails, primePeer, user.adminReady, user.isAdmin]);

    useEffect(() => {
        if (!user.isAdmin) {
            return;
        }

        const uids = Array.from(
            new Set(
                [
                    ...offendersRaw.map((row) => cleanText(row.uid)),
                    ...Object.values(detailsRaw).map((value) => cleanText(value?.uid)),
                    ...botsRaw.map((row) => cleanText(row.id)),
                    ...Object.values(botDetailsRaw).map((value) => cleanText(value?.bot?.id || value?.botUid)),
                ].filter(Boolean)
            )
        );

        for (const [uid, unsubscribe] of moderationUnsubsRef.current.entries()) {
            if (uids.includes(uid)) {
                continue;
            }
            unsubscribe?.();
            moderationUnsubsRef.current.delete(uid);
            setModerationRaw((prev) => {
                if (!(uid in prev)) {
                    return prev;
                }
                const next = { ...prev };
                delete next[uid];
                return next;
            });
        }

        uids.forEach((uid) => {
            if (moderationUnsubsRef.current.has(uid)) {
                return;
            }

            const unsubscribe = cloud.admin.moderation.watch(
                uid,
                (banned) => {
                    setModerationRaw((prev) => ({
                        ...prev,
                        [uid]: banned ?? null,
                    }));
                },
                (error) => {
                    console.warn('failed to subscribe moderation', error);
                    setModerationRaw((prev) => ({
                        ...prev,
                        [uid]: null,
                    }));
                }
            );

            moderationUnsubsRef.current.set(uid, unsubscribe);
        });
    }, [botDetailsRaw, botsRaw, detailsRaw, offendersRaw, user.isAdmin]);

    const person = useCallback(
        (uid) => {
            const value = cleanText(uid);
            if (!value) {
                return { uid: '', username: null, avatar: null, active: false, bot: null };
            }

            if (user.uid === value) {
                return {
                    uid: value,
                    username: user.username || null,
                    avatar: user.avatar || null,
                    active: !!user.active,
                    bot: user.bot || null,
                };
            }

            const peer = findPeer(value);
            return {
                uid: value,
                username: peer?.username || null,
                avatar: peer?.avatar || null,
                active: !!peer?.active,
                bot: peer?.bot || null,
                walletPK: peer?.walletPK || null,
                chatPK: peer?.chatPK || null,
            };
        },
        [findPeer, user.active, user.avatar, user.bot, user.uid, user.username]
    );

    const decorateBot = useCallback(
        (row) => {
            const uid = cleanText(row?.id || row?.uid);
            const peer = person(uid);
            const banned = uid ? moderationRaw[uid] || null : null;
            const bans = banState(banned);
            const username = peer.username || cleanText(row?.username) || null;
            const walletPK = peer.walletPK || resolveWalletPK(row, WALLET_NETWORK) || null;

            return {
                ...row,
                ...peer,
                uid,
                username,
                walletPK,
                avatar: peer.avatar || null,
                active: runtimeRunning && row?.enabled === true,
                slug: username || uid,
                enabled: row?.enabled === true,
                status: cleanText(row?.status),
                banned,
                chatBanned: bans.chatBanned,
                avatarBanned: bans.avatarBanned,
            };
        },
        [moderationRaw, person, runtimeRunning]
    );

    const offenders = useMemo(
        () =>
            offendersRaw.map((row) => {
                const peer = person(row.uid);
                const banned = moderationRaw[row.uid] || null;
                const bans = banState(banned);
                return {
                    ...peer,
                    uid: row.uid,
                    count: row.count,
                    lastReportAt: row.lastReportAt,
                    slug: peer.username || row.uid,
                    banned,
                    chatBanned: bans.chatBanned,
                    avatarBanned: bans.avatarBanned,
                };
            }),
        [moderationRaw, offendersRaw, person]
    );

    const bots = useMemo(() => botsRaw.map((row) => decorateBot(row)), [botsRaw, decorateBot]);

    const resolveOffenderUid = useCallback(
        async (identifier) => {
            const raw = cleanText(identifier);
            if (!raw) return null;

            const direct = offendersRaw.find((row) => row.uid === raw);
            if (direct) return direct.uid;

            for (const row of offendersRaw) {
                const peer = findPeer(row.uid);
                if (peer?.username === raw) return row.uid;
            }

            try {
                const peer = await cloud.search.peer.byUsername(raw);
                if (peer?.uid) return cleanText(peer.uid);
            } catch (error) {
                console.warn('failed to resolve offender username', error);
            }

            return raw;
        },
        [findPeer, offendersRaw]
    );

    const resolveBotUid = useCallback(
        async (identifier) => {
            const raw = cleanText(identifier);
            if (!raw) return null;

            const directByUid = botsRaw.find((row) => row.id === raw);
            if (directByUid) return directByUid.id;

            const byUsername = botsRaw.find((row) => cleanText(row.username) === raw);
            if (byUsername) return byUsername.id;

            try {
                const peer = await cloud.search.peer.byUsername(raw);
                const uid = cleanText(peer?.uid);
                if (uid) {
                    const match = botsRaw.find((row) => row.id === uid);
                    if (match) return match.id;
                }
            } catch (error) {
                console.warn('failed to resolve bot username', error);
            }

            return null;
        },
        [botsRaw]
    );

    const loadOffender = useCallback(
        async (identifier) => {
            const key = cleanText(identifier);
            if (!key || !user.isAdmin) return null;

            const existing = detailsRaw[key];
            if (existing?.loading || existing?.uid || existing?.error) {
                return existing?.uid || null;
            }

            setDetailsRaw((prev) => ({
                ...prev,
                [key]: {
                    ...prev[key],
                    uid: prev[key]?.uid || null,
                    reports: prev[key]?.reports || [],
                    loading: true,
                    error: '',
                },
            }));

            const uid = await resolveOffenderUid(key);
            if (!uid) {
                setDetailsRaw((prev) => ({
                    ...prev,
                    [key]: { loading: false, error: 'not-found', uid: null, reports: [] },
                }));
                return null;
            }

            void primePeer({ uid });

            detailUnsubsRef.current.get(key)?.();
            const unsubscribe = cloud.admin.reports.watchUser(
                uid,
                (records = []) => {
                    const reports = records
                        .sort((a, b) => timestampMs(b.createdAt, 0, { parseString: true }) - timestampMs(a.createdAt, 0, { parseString: true }));

                    reports.forEach((report) => {
                        const reporter = cleanText(report?.reporter);
                        if (reporter) void primePeer({ uid: reporter });
                    });

                    setDetailsRaw((prev) => ({
                        ...prev,
                        [key]: { uid, loading: false, error: '', reports },
                    }));
                },
                (error) => {
                    console.warn('failed to subscribe reports', error);
                    setDetailsRaw((prev) => ({
                        ...prev,
                        [key]: { uid, loading: false, error: 'load-failed', reports: [] },
                    }));
                }
            );

            detailUnsubsRef.current.set(key, unsubscribe);
            return uid;
        },
        [detailsRaw, primePeer, resolveOffenderUid, user.isAdmin]
    );

    const loadBot = useCallback(
        async (identifier) => {
            const key = cleanText(identifier);
            if (!key || !user.isAdmin) return null;

            const existing = botDetailsRaw[key];
            if (existing?.loading || existing?.botUid || existing?.error) {
                return existing?.botUid || null;
            }

            setBotDetailsRaw((prev) => ({
                ...prev,
                [key]: {
                    ...prev[key],
                    botUid: prev[key]?.botUid || null,
                    bot: prev[key]?.bot || null,
                    events: prev[key]?.events || [],
                    loading: true,
                    error: '',
                },
            }));

            const botUid = await resolveBotUid(key);
            if (!botUid) {
                setBotDetailsRaw((prev) => ({
                    ...prev,
                    [key]: { loading: false, error: 'not-found', botUid: null, bot: null, events: [] },
                }));
                return null;
            }

            botDetailUnsubsRef.current.get(key)?.();
            botEventUnsubsRef.current.get(key)?.();

            const detailUnsub = cloud.admin.bots.watchBot(
                botUid,
                (record, info = {}) => {
                    if (!info.exists || !record) {
                        setBotDetailsRaw((prev) => ({
                            ...prev,
                            [key]: { ...(prev[key] || {}), loading: false, error: 'not-found', botUid, bot: null },
                        }));
                        return;
                    }

                    const bot = { ...record, id: cleanText(record?.id) };
                    if (bot?.id) void primePeer({ uid: bot.id });

                    setBotDetailsRaw((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), loading: false, error: '', botUid, bot },
                    }));
                },
                (error) => {
                    console.warn('failed to subscribe bot detail', error);
                    setBotDetailsRaw((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), loading: false, error: 'load-failed', botUid, bot: null },
                    }));
                }
            );

            const eventsUnsub = cloud.admin.bots.watchEvents(
                botUid,
                (events = []) => {
                    events.forEach((event) => {
                        if (event?.peerUid) void primePeer({ uid: event.peerUid });
                    });

                    setBotDetailsRaw((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), botUid, events },
                    }));
                },
                (error) => {
                    console.warn('failed to subscribe bot events', error);
                    setBotDetailsRaw((prev) => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), events: [], eventsError: error?.message || 'load-failed' },
                    }));
                },
                { count: 50 }
            );

            botDetailUnsubsRef.current.set(key, detailUnsub);
            botEventUnsubsRef.current.set(key, eventsUnsub);
            return botUid;
        },
        [botDetailsRaw, primePeer, resolveBotUid, user.isAdmin]
    );

    const details = useMemo(() => {
        const offenderMap = new Map(offendersRaw.map((row) => [row.uid, row]));

        return Object.fromEntries(
            Object.entries(detailsRaw).map(([key, value]) => {
                const uid = cleanText(value?.uid);
                const offenderRow = uid ? offenderMap.get(uid) || { uid, count: 0, lastReportAt: null } : null;
                const banned = uid ? moderationRaw[uid] || null : null;
                const bans = banState(banned);
                const offender = uid ? person(uid) : null;

                return [
                    key,
                    {
                        ...value,
                        data: uid
                            ? {
                                  offender: {
                                      ...offender,
                                      uid,
                                      count: offenderRow?.count || 0,
                                      lastReportAt: offenderRow?.lastReportAt || null,
                                      slug: offender?.username || uid,
                                      banned,
                                      chatBanned: bans.chatBanned,
                                      avatarBanned: bans.avatarBanned,
                                  },
                                  reports: (value?.reports || []).map((report) => ({
                                      ...report,
                                      reporterUid: cleanText(report?.reporter),
                                      reporter: person(report?.reporter),
                                      parsed: parseReportEvidence(report),
                                  })),
                              }
                            : null,
                    },
                ];
            })
        );
    }, [detailsRaw, moderationRaw, offendersRaw, person]);

    const botDetails = useMemo(() => {
        const botMap = new Map(botsRaw.map((row) => [row.id, row]));

        return Object.fromEntries(
            Object.entries(botDetailsRaw).map(([key, value]) => {
                const botUid = lowerText(value?.botUid);
                const rawBot = value?.bot || (botUid ? botMap.get(botUid) || null : null);
                const bot = rawBot ? decorateBot(rawBot) : null;

                return [
                    key,
                    {
                        ...value,
                        data: bot
                            ? {
                                  bot,
                                  events: (value?.events || []).map((event) => ({
                                      ...event,
                                      peerUid: cleanText(event?.peerUid),
                                      peer: person(event?.peerUid),
                                  })),
                              }
                            : null,
                    },
                ];
            })
        );
    }, [botDetailsRaw, botsRaw, decorateBot, person]);

    const banUser = useCallback(
        async (uid, feature = 'chat') => {
            if (!uid || !user.isAdmin) throw new Error('admin required');
            await cloud.admin.moderation.ban(uid, feature);
        },
        [user.isAdmin]
    );

    const unbanUser = useCallback(
        async (uid, feature = 'chat') => {
            if (!uid || !user.isAdmin) throw new Error('admin required');
            await cloud.admin.moderation.unban(uid, feature);
        },
        [user.isAdmin]
    );

    const powerBot = useCallback(
        async (uid, enabled) => {
            if (!uid || !user.isAdmin) throw new Error('admin required');
            await cloud.admin.bots.power(uid, enabled);
        },
        [user.isAdmin]
    );

    const value = useMemo(
        () => ({
            offenders,
            offendersReady,
            details,
            loadOffender,
            banUser,
            unbanUser,
            bots,
            botsReady,
            botDetails,
            loadBot,
            powerBot,
            runtimeRunning,
        }),
        [banUser, botDetails, bots, botsReady, details, loadBot, loadOffender, offenders, offendersReady, powerBot, runtimeRunning, unbanUser]
    );

    return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminData() {
    const value = useContext(AdminContext);
    if (!value) {
        throw new Error('useAdminData must be used within an AdminProvider');
    }
    return value;
}
