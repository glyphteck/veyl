const GIB_PER_MIB = 1 / 1024;
const GIB_PER_KIB = 1 / (1024 * 1024);
const SECONDS_PER_DAY = 24 * 60 * 60;

export const DEFAULT_ASSUMPTIONS = Object.freeze({
    daysPerMonth: 30,
    retainedSavedDays: 360,
    averageMediaMiB: 5,
    averageAvatarKiB: 25,
    avatarUploadRate: 0.9,
    textMessagesPerActiveUserDay: 24,
    mediaMessagesPerActiveUserDay: 1,
    readReceiptsPerActiveUserDay: 25,
    reactionsPerActiveUserDay: 2,
    walletTransactionsPerActiveUserDay: 0.1,
    savedTextMessageRate: 0.1,
    savedMediaMessageRate: 0.1,
    savedMessageDocKiB: 2,
    routineMediaLiveDays: 21,
    mediaDownloadGiBPerActiveUserMonth: 0,
    functionComputeCostPerActiveUserMonth: 0,
    sparkCostPerActiveUserMonth: 0,
    moderationLaborCostMonth: 0,
    fixedReadsPerActiveUserDay: 147,
    fixedWritesPerActiveUserDay: 5,
    fixedFunctionInvocationsPerActiveUserDay: 1,
    fixedStorageClassAOpsPerActiveUserDay: 0,
    messageSendFirestoreReadsPerMessage: 6,
    messageSendFirestoreWritesPerMessage: 4,
    messageSendFunctionInvocationsPerMessage: 1,
    readReceiptFirestoreReadsPerMessage: 1,
    readReceiptFirestoreWritesPerMessage: 1,
    reactionFirestoreReadsPerReaction: 1,
    reactionFirestoreWritesPerReaction: 1,
    mediaStorageClassAOpsPerMessage: 1,
    btcSchedulerWritesPerDay: 1440,
    btcSchedulerFunctionInvocationsPerDay: 1440,
});

export const DEFAULT_RATES = Object.freeze({
    firestoreRead: 0.06 / 100000,
    firestoreWrite: 0.18 / 100000,
    firestoreDelete: 0.02 / 100000,
    firestoreStorageGiBMonth: 0.18,
    functionInvocation: 0.40 / 1000000,
    storageGiBMonth: 0.020,
    storageClassA: 0.005 / 1000,
    storageClassB: 0.0004 / 1000,
    mediaDownloadGiB: 0,
    createAccountSkipAvatar: 0.000027,
    createAccountUploadAvatar: 0.000033,
});

export const DEFAULT_FREE_QUOTAS = Object.freeze({
    firestoreReadsPerDay: 50000,
    firestoreWritesPerDay: 20000,
    firestoreDeletesPerDay: 20000,
    functionInvocationsPerMonth: 2000000,
});

function mergeModel({ assumptions = {}, rates = {}, freeQuotas = {} } = {}) {
    return {
        assumptions: { ...DEFAULT_ASSUMPTIONS, ...assumptions },
        rates: { ...DEFAULT_RATES, ...rates },
        freeQuotas: { ...DEFAULT_FREE_QUOTAS, ...freeQuotas },
    };
}

function paidUsage(usage, freeQuota) {
    return Math.max(0, usage - freeQuota);
}

function roundCost(value, digits = 6) {
    return Number(value.toFixed(digits));
}

function visibleMessagesPerActiveUserDay(assumptions) {
    return assumptions.textMessagesPerActiveUserDay + assumptions.mediaMessagesPerActiveUserDay;
}

function savedMessageDocsPerActiveUserDay(assumptions) {
    return assumptions.textMessagesPerActiveUserDay * assumptions.savedTextMessageRate +
        assumptions.mediaMessagesPerActiveUserDay * assumptions.savedMediaMessageRate;
}

function saveTextOpsCost(rates) {
    return 4 * rates.firestoreRead + 3 * rates.firestoreWrite + rates.functionInvocation;
}

function saveMediaOpsCost(rates) {
    return saveTextOpsCost(rates) + rates.storageClassA;
}

function saveOpsPerActiveUserDay(assumptions, rates) {
    return assumptions.textMessagesPerActiveUserDay * assumptions.savedTextMessageRate * saveTextOpsCost(rates) +
        assumptions.mediaMessagesPerActiveUserDay * assumptions.savedMediaMessageRate * saveMediaOpsCost(rates);
}

function activeOpsPerActiveUserDay(assumptions) {
    const visibleMessages = visibleMessagesPerActiveUserDay(assumptions);
    return {
        visibleMessages,
        walletTransactions: assumptions.walletTransactionsPerActiveUserDay,
        firestoreReads:
            assumptions.fixedReadsPerActiveUserDay +
            visibleMessages * assumptions.messageSendFirestoreReadsPerMessage +
            assumptions.readReceiptsPerActiveUserDay * assumptions.readReceiptFirestoreReadsPerMessage +
            assumptions.reactionsPerActiveUserDay * assumptions.reactionFirestoreReadsPerReaction,
        firestoreWrites:
            assumptions.fixedWritesPerActiveUserDay +
            visibleMessages * assumptions.messageSendFirestoreWritesPerMessage +
            assumptions.readReceiptsPerActiveUserDay * assumptions.readReceiptFirestoreWritesPerMessage +
            assumptions.reactionsPerActiveUserDay * assumptions.reactionFirestoreWritesPerReaction,
        functionInvocations:
            assumptions.fixedFunctionInvocationsPerActiveUserDay +
            visibleMessages * assumptions.messageSendFunctionInvocationsPerMessage,
        storageClassAOps:
            assumptions.fixedStorageClassAOpsPerActiveUserDay +
            assumptions.mediaMessagesPerActiveUserDay * assumptions.mediaStorageClassAOpsPerMessage,
    };
}

export function dailyActiveUserCost(options = {}) {
    const { assumptions, rates } = mergeModel(options);
    const activeOps = activeOpsPerActiveUserDay(assumptions);
    const saveOps = saveOpsPerActiveUserDay(assumptions, rates);
    const baseOps =
        activeOps.firestoreReads * rates.firestoreRead +
        activeOps.firestoreWrites * rates.firestoreWrite +
        activeOps.functionInvocations * rates.functionInvocation +
        activeOps.storageClassAOps * rates.storageClassA;

    const savedMessageDocs = savedMessageDocsPerActiveUserDay(assumptions);
    const savedFirestoreKiB = savedMessageDocs * assumptions.savedMessageDocKiB;
    const savedMediaMiB = assumptions.mediaMessagesPerActiveUserDay * assumptions.savedMediaMessageRate * assumptions.averageMediaMiB;

    return {
        visibleMessages: roundCost(activeOps.visibleMessages, 3),
        walletTransactions: roundCost(activeOps.walletTransactions, 3),
        firestoreReads: roundCost(activeOps.firestoreReads, 3),
        firestoreWrites: roundCost(activeOps.firestoreWrites, 3),
        functionInvocations: roundCost(activeOps.functionInvocations, 3),
        storageClassAOps: roundCost(activeOps.storageClassAOps, 3),
        baseOps: roundCost(baseOps),
        saveOps: roundCost(saveOps),
        immediateOps: roundCost(baseOps + saveOps),
        savedMessageDocs: roundCost(savedMessageDocs, 3),
        savedFirestoreKiB: roundCost(savedFirestoreKiB, 3),
        savedMediaMiB: roundCost(savedMediaMiB, 3),
    };
}

export function newAccountCost(options = {}) {
    const { assumptions, rates } = mergeModel(options);
    const weightedOps =
        rates.createAccountSkipAvatar +
        assumptions.avatarUploadRate * (rates.createAccountUploadAvatar - rates.createAccountSkipAvatar);
    const avatarStorageMonth =
        assumptions.avatarUploadRate *
        assumptions.averageAvatarKiB *
        GIB_PER_KIB *
        rates.storageGiBMonth;

    return {
        weightedOps: roundCost(weightedOps),
        avatarStorageMonth: roundCost(avatarStorageMonth, 9),
        total: roundCost(weightedOps + avatarStorageMonth),
    };
}

export function monthlyBaseOpsCost(dau, options = {}) {
    const { assumptions, rates, freeQuotas } = mergeModel(options);
    const days = assumptions.daysPerMonth;
    const activeOps = activeOpsPerActiveUserDay(assumptions);
    const readsPerDay = dau * activeOps.firestoreReads;
    const writesPerDay = dau * activeOps.firestoreWrites + assumptions.btcSchedulerWritesPerDay;
    const functionsPerMonth =
        (dau * activeOps.functionInvocations + assumptions.btcSchedulerFunctionInvocationsPerDay) * days;
    const storageClassAOpsPerMonth = dau * activeOps.storageClassAOps * days;

    const firestoreReads = paidUsage(readsPerDay, freeQuotas.firestoreReadsPerDay) * rates.firestoreRead * days;
    const firestoreWrites = paidUsage(writesPerDay, freeQuotas.firestoreWritesPerDay) * rates.firestoreWrite * days;
    const functions = paidUsage(functionsPerMonth, freeQuotas.functionInvocationsPerMonth) * rates.functionInvocation;
    const storageClassA = storageClassAOpsPerMonth * rates.storageClassA;

    return {
        firestoreReads: roundCost(firestoreReads),
        firestoreWrites: roundCost(firestoreWrites),
        functions: roundCost(functions),
        storageClassA: roundCost(storageClassA),
        total: roundCost(firestoreReads + firestoreWrites + functions + storageClassA),
    };
}

export function monthlyRetentionCost(dau, options = {}) {
    const { assumptions, rates } = mergeModel(options);
    const days = assumptions.daysPerMonth;
    const savedDocsPerActiveUserDay = savedMessageDocsPerActiveUserDay(assumptions);
    const savedFirestoreGiBPerActiveUserDay = savedDocsPerActiveUserDay * assumptions.savedMessageDocKiB * GIB_PER_KIB;
    const savedMediaGiBPerActiveUserDay =
        assumptions.mediaMessagesPerActiveUserDay *
        assumptions.savedMediaMessageRate *
        assumptions.averageMediaMiB *
        GIB_PER_MIB;
    const routineLiveMediaGiBPerActiveUser =
        assumptions.mediaMessagesPerActiveUserDay *
        assumptions.averageMediaMiB *
        assumptions.routineMediaLiveDays *
        GIB_PER_MIB;

    const saveOps = dau * days * saveOpsPerActiveUserDay(assumptions, rates);
    const routineLiveMedia = dau * routineLiveMediaGiBPerActiveUser * rates.storageGiBMonth;
    const savedMedia = dau * assumptions.retainedSavedDays * savedMediaGiBPerActiveUserDay * rates.storageGiBMonth;
    const savedFirestore = dau * assumptions.retainedSavedDays * savedFirestoreGiBPerActiveUserDay * rates.firestoreStorageGiBMonth;

    return {
        saveOps: roundCost(saveOps),
        routineLiveMedia: roundCost(routineLiveMedia),
        savedMedia: roundCost(savedMedia),
        savedFirestore: roundCost(savedFirestore),
        total: roundCost(saveOps + routineLiveMedia + savedMedia + savedFirestore),
    };
}

export function monthlyExtraCost(dau, options = {}) {
    const { assumptions, rates } = mergeModel(options);
    const mediaDownload = dau * assumptions.mediaDownloadGiBPerActiveUserMonth * rates.mediaDownloadGiB;
    const functionCompute = dau * assumptions.functionComputeCostPerActiveUserMonth;
    const spark = dau * assumptions.sparkCostPerActiveUserMonth;
    const moderation = assumptions.moderationLaborCostMonth;
    const total = mediaDownload + functionCompute + spark + moderation;

    return {
        mediaDownload: roundCost(mediaDownload),
        functionCompute: roundCost(functionCompute),
        spark: roundCost(spark),
        moderation: roundCost(moderation),
        total: roundCost(total),
    };
}

export function throughputAtDau(dau, options = {}) {
    if (!Number.isFinite(dau) || dau < 0) {
        throw new Error('dau must be a non-negative number');
    }

    const { assumptions } = mergeModel(options);
    const visibleMessages = visibleMessagesPerActiveUserDay(assumptions);
    const walletTransactions = assumptions.walletTransactionsPerActiveUserDay;
    const messagesPerDay = dau * visibleMessages;
    const walletTransactionsPerDay = dau * walletTransactions;

    return {
        dau,
        messagesPerActiveUserDay: roundCost(visibleMessages, 3),
        walletTransactionsPerActiveUserDay: roundCost(walletTransactions, 3),
        messagesPerDay: roundCost(messagesPerDay, 3),
        walletTransactionsPerDay: roundCost(walletTransactionsPerDay, 3),
        messagesPerSecond: roundCost(messagesPerDay / SECONDS_PER_DAY, 3),
        walletTransactionsPerSecond: roundCost(walletTransactionsPerDay / SECONDS_PER_DAY, 3),
    };
}

export function monthlyMessageRateCost(messagesPerSecond, options = {}) {
    if (!Number.isFinite(messagesPerSecond) || messagesPerSecond < 0) {
        throw new Error('messagesPerSecond must be a non-negative number');
    }

    const { includeReadReceipts = false, ...modelOptions } = options;
    const { assumptions, rates, freeQuotas } = mergeModel(modelOptions);
    const days = assumptions.daysPerMonth;
    const secondsPerMonth = SECONDS_PER_DAY * days;
    const messagesPerDay = messagesPerSecond * SECONDS_PER_DAY;
    const messagesPerMonth = messagesPerSecond * secondsPerMonth;

    const firestoreReadsPerMessage =
        assumptions.messageSendFirestoreReadsPerMessage +
        (includeReadReceipts ? assumptions.readReceiptFirestoreReadsPerMessage : 0);
    const firestoreWritesPerMessage =
        assumptions.messageSendFirestoreWritesPerMessage +
        (includeReadReceipts ? assumptions.readReceiptFirestoreWritesPerMessage : 0);
    const functionInvocationsPerMessage = assumptions.messageSendFunctionInvocationsPerMessage;

    const firestoreReadsPerDay = messagesPerDay * firestoreReadsPerMessage;
    const firestoreWritesPerDay = messagesPerDay * firestoreWritesPerMessage;
    const functionInvocationsPerMonth = messagesPerMonth * functionInvocationsPerMessage;

    const grossFirestoreReads = messagesPerMonth * firestoreReadsPerMessage * rates.firestoreRead;
    const grossFirestoreWrites = messagesPerMonth * firestoreWritesPerMessage * rates.firestoreWrite;
    const grossFunctions = functionInvocationsPerMonth * rates.functionInvocation;
    const paidFirestoreReads =
        paidUsage(firestoreReadsPerDay, freeQuotas.firestoreReadsPerDay) * rates.firestoreRead * days;
    const paidFirestoreWrites =
        paidUsage(firestoreWritesPerDay, freeQuotas.firestoreWritesPerDay) * rates.firestoreWrite * days;
    const paidFunctions =
        paidUsage(functionInvocationsPerMonth, freeQuotas.functionInvocationsPerMonth) * rates.functionInvocation;

    return {
        messagesPerSecond,
        messagesPerDay: roundCost(messagesPerDay, 3),
        messagesPerMonth: roundCost(messagesPerMonth, 3),
        includeReadReceipts,
        operationsPerMessage: {
            firestoreReads: roundCost(firestoreReadsPerMessage, 3),
            firestoreWrites: roundCost(firestoreWritesPerMessage, 3),
            functionInvocations: roundCost(functionInvocationsPerMessage, 3),
        },
        gross: {
            firestoreReads: roundCost(grossFirestoreReads),
            firestoreWrites: roundCost(grossFirestoreWrites),
            functions: roundCost(grossFunctions),
            total: roundCost(grossFirestoreReads + grossFirestoreWrites + grossFunctions),
        },
        paid: {
            firestoreReads: roundCost(paidFirestoreReads),
            firestoreWrites: roundCost(paidFirestoreWrites),
            functions: roundCost(paidFunctions),
            total: roundCost(paidFirestoreReads + paidFirestoreWrites + paidFunctions),
        },
    };
}

export function monthlyCost(dau, options = {}) {
    const baseOps = monthlyBaseOpsCost(dau, options);
    const retention = monthlyRetentionCost(dau, options);
    const extras = monthlyExtraCost(dau, options);
    const throughput = throughputAtDau(dau, options);
    const total = baseOps.total + retention.total + extras.total;

    return {
        dau,
        throughput,
        baseOps,
        retention,
        extras,
        total: roundCost(total),
    };
}

function readNumberEnv(name, fallback) {
    const value = process.env[name];
    if (value == null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${name} must be a number`);
    }
    return parsed;
}

function readBooleanEnv(name, fallback) {
    const value = process.env[name];
    if (value == null || value === '') return fallback;
    const normalized = value.toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    throw new Error(`${name} must be a boolean`);
}

function cliOptions() {
    return {
        assumptions: {
            daysPerMonth: readNumberEnv('DAYS_PER_MONTH', DEFAULT_ASSUMPTIONS.daysPerMonth),
            retainedSavedDays: readNumberEnv('RETAINED_SAVED_DAYS', DEFAULT_ASSUMPTIONS.retainedSavedDays),
            averageMediaMiB: readNumberEnv('MEDIA_MIB', DEFAULT_ASSUMPTIONS.averageMediaMiB),
            averageAvatarKiB: readNumberEnv('AVATAR_KIB', DEFAULT_ASSUMPTIONS.averageAvatarKiB),
            avatarUploadRate: readNumberEnv('AVATAR_UPLOAD_RATE', DEFAULT_ASSUMPTIONS.avatarUploadRate),
            textMessagesPerActiveUserDay: readNumberEnv('TEXT_MESSAGES_PER_ACTIVE_USER_DAY', DEFAULT_ASSUMPTIONS.textMessagesPerActiveUserDay),
            mediaMessagesPerActiveUserDay: readNumberEnv('MEDIA_MESSAGES_PER_ACTIVE_USER_DAY', DEFAULT_ASSUMPTIONS.mediaMessagesPerActiveUserDay),
            readReceiptsPerActiveUserDay: readNumberEnv('READ_RECEIPTS_PER_ACTIVE_USER_DAY', DEFAULT_ASSUMPTIONS.readReceiptsPerActiveUserDay),
            reactionsPerActiveUserDay: readNumberEnv('REACTIONS_PER_ACTIVE_USER_DAY', DEFAULT_ASSUMPTIONS.reactionsPerActiveUserDay),
            walletTransactionsPerActiveUserDay: readNumberEnv('WALLET_TXS_PER_ACTIVE_USER_DAY', DEFAULT_ASSUMPTIONS.walletTransactionsPerActiveUserDay),
            savedTextMessageRate: readNumberEnv('SAVED_TEXT_RATE', DEFAULT_ASSUMPTIONS.savedTextMessageRate),
            savedMediaMessageRate: readNumberEnv('SAVED_MEDIA_RATE', DEFAULT_ASSUMPTIONS.savedMediaMessageRate),
            mediaDownloadGiBPerActiveUserMonth: readNumberEnv('MEDIA_DOWNLOAD_GIB_PER_ACTIVE_USER_MONTH', DEFAULT_ASSUMPTIONS.mediaDownloadGiBPerActiveUserMonth),
            functionComputeCostPerActiveUserMonth: readNumberEnv('FUNCTION_COMPUTE_COST_PER_ACTIVE_USER_MONTH', DEFAULT_ASSUMPTIONS.functionComputeCostPerActiveUserMonth),
            sparkCostPerActiveUserMonth: readNumberEnv('SPARK_COST_PER_ACTIVE_USER_MONTH', DEFAULT_ASSUMPTIONS.sparkCostPerActiveUserMonth),
            moderationLaborCostMonth: readNumberEnv('MODERATION_COST_MONTH', DEFAULT_ASSUMPTIONS.moderationLaborCostMonth),
            messageSendFirestoreReadsPerMessage: readNumberEnv('MESSAGE_SEND_READS', DEFAULT_ASSUMPTIONS.messageSendFirestoreReadsPerMessage),
            messageSendFirestoreWritesPerMessage: readNumberEnv('MESSAGE_SEND_WRITES', DEFAULT_ASSUMPTIONS.messageSendFirestoreWritesPerMessage),
            messageSendFunctionInvocationsPerMessage: readNumberEnv('MESSAGE_SEND_FUNCTIONS', DEFAULT_ASSUMPTIONS.messageSendFunctionInvocationsPerMessage),
            readReceiptFirestoreReadsPerMessage: readNumberEnv('READ_RECEIPT_READS', DEFAULT_ASSUMPTIONS.readReceiptFirestoreReadsPerMessage),
            readReceiptFirestoreWritesPerMessage: readNumberEnv('READ_RECEIPT_WRITES', DEFAULT_ASSUMPTIONS.readReceiptFirestoreWritesPerMessage),
        },
        rates: {
            mediaDownloadGiB: readNumberEnv('MEDIA_DOWNLOAD_GIB_COST', DEFAULT_RATES.mediaDownloadGiB),
        },
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const options = cliOptions();
    if (process.env.MESSAGES_PER_SECOND != null && process.env.MESSAGES_PER_SECOND !== '') {
        const messagesPerSecond = readNumberEnv('MESSAGES_PER_SECOND', 1);
        const includeReadReceipts = readBooleanEnv('INCLUDE_READ_RECEIPTS', false);
        console.log(JSON.stringify(monthlyMessageRateCost(messagesPerSecond, { ...options, includeReadReceipts }), null, 2));
    } else {
        const dau = readNumberEnv('DAU', 1000000);
        console.log(JSON.stringify(monthlyCost(dau, options), null, 2));
    }
}
