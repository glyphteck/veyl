const GIB_PER_MIB = 1 / 1024;
const GIB_PER_KIB = 1 / (1024 * 1024);

export const DEFAULT_ASSUMPTIONS = Object.freeze({
    daysPerMonth: 30,
    retainedSavedDays: 360,
    monthlyActiveUsersPerDau: 3,
    averageMediaMiB: 5,
    averageAvatarKiB: 25,
    avatarUploadRate: 0.9,
    textMessagesPerDauDay: 10,
    mediaMessagesPerDauDay: 1,
    savedTextMessageRate: 0.1,
    savedMediaMessageRate: 0.1,
    savedMessageDocKiB: 2,
    routineMediaLiveDays: 21,
    mediaDownloadGiBPerDauMonth: 0,
    functionComputeCostPerDauMonth: 0,
    sparkCostPerDauMonth: 0,
    moderationLaborCostMonth: 0,
    baseReadsPerDauDay: 260,
    baseWritesPerDauDay: 35,
    baseFunctionInvocationsPerDauDay: 11,
    baseStorageClassAOpsPerDauDay: 1,
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
    authMau: 0.0055,
    createAccountSkipAvatar: 0.000027,
    createAccountUploadAvatar: 0.000033,
    saveOpsPerDauDay: 0.00001027,
});

export const DEFAULT_FREE_QUOTAS = Object.freeze({
    firestoreReadsPerDay: 50000,
    firestoreWritesPerDay: 20000,
    firestoreDeletesPerDay: 20000,
    functionInvocationsPerMonth: 2000000,
    authMauPerMonth: 50000,
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

export function dailyActiveUserCost(options = {}) {
    const { assumptions, rates } = mergeModel(options);
    const baseOps =
        assumptions.baseReadsPerDauDay * rates.firestoreRead +
        assumptions.baseWritesPerDauDay * rates.firestoreWrite +
        assumptions.baseFunctionInvocationsPerDauDay * rates.functionInvocation +
        assumptions.baseStorageClassAOpsPerDauDay * rates.storageClassA;

    const savedMessageDocs =
        assumptions.textMessagesPerDauDay * assumptions.savedTextMessageRate +
        assumptions.mediaMessagesPerDauDay * assumptions.savedMediaMessageRate;
    const savedFirestoreKiB = savedMessageDocs * assumptions.savedMessageDocKiB;
    const savedMediaMiB = assumptions.mediaMessagesPerDauDay * assumptions.savedMediaMessageRate * assumptions.averageMediaMiB;

    return {
        baseOps: roundCost(baseOps),
        saveOps: roundCost(rates.saveOpsPerDauDay),
        immediateOps: roundCost(baseOps + rates.saveOpsPerDauDay),
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
    const paidAuthMau = rates.authMau;

    return {
        weightedOps: roundCost(weightedOps),
        avatarStorageMonth: roundCost(avatarStorageMonth, 9),
        paidAuthMau: roundCost(paidAuthMau),
        paidMarginalTotal: roundCost(weightedOps + avatarStorageMonth + paidAuthMau),
        withinAuthFreeTierTotal: roundCost(weightedOps + avatarStorageMonth),
    };
}

export function monthlyBaseOpsCost(dau, options = {}) {
    const { assumptions, rates, freeQuotas } = mergeModel(options);
    const days = assumptions.daysPerMonth;
    const readsPerDay = dau * assumptions.baseReadsPerDauDay;
    const writesPerDay = dau * assumptions.baseWritesPerDauDay + assumptions.btcSchedulerWritesPerDay;
    const functionsPerMonth =
        (dau * assumptions.baseFunctionInvocationsPerDauDay + assumptions.btcSchedulerFunctionInvocationsPerDay) * days;
    const storageClassAOpsPerMonth = dau * assumptions.baseStorageClassAOpsPerDauDay * days;

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
    const savedDocsPerDauDay =
        assumptions.textMessagesPerDauDay * assumptions.savedTextMessageRate +
        assumptions.mediaMessagesPerDauDay * assumptions.savedMediaMessageRate;
    const savedFirestoreGiBPerDauDay = savedDocsPerDauDay * assumptions.savedMessageDocKiB * GIB_PER_KIB;
    const savedMediaGiBPerDauDay =
        assumptions.mediaMessagesPerDauDay *
        assumptions.savedMediaMessageRate *
        assumptions.averageMediaMiB *
        GIB_PER_MIB;
    const routineLiveMediaGiBPerDau =
        assumptions.mediaMessagesPerDauDay *
        assumptions.averageMediaMiB *
        assumptions.routineMediaLiveDays *
        GIB_PER_MIB;

    const saveOps = dau * days * rates.saveOpsPerDauDay;
    const routineLiveMedia = dau * routineLiveMediaGiBPerDau * rates.storageGiBMonth;
    const savedMedia = dau * assumptions.retainedSavedDays * savedMediaGiBPerDauDay * rates.storageGiBMonth;
    const savedFirestore = dau * assumptions.retainedSavedDays * savedFirestoreGiBPerDauDay * rates.firestoreStorageGiBMonth;

    return {
        saveOps: roundCost(saveOps),
        routineLiveMedia: roundCost(routineLiveMedia),
        savedMedia: roundCost(savedMedia),
        savedFirestore: roundCost(savedFirestore),
        total: roundCost(saveOps + routineLiveMedia + savedMedia + savedFirestore),
    };
}

export function monthlyAuthCost(dau, options = {}) {
    const { assumptions, rates, freeQuotas } = mergeModel(options);
    const mau = dau * assumptions.monthlyActiveUsersPerDau;
    const paidMau = paidUsage(mau, freeQuotas.authMauPerMonth);
    const total = paidMau * rates.authMau;

    return {
        mau,
        paidMau,
        total: roundCost(total),
    };
}

export function monthlyExtraCost(dau, options = {}) {
    const { assumptions, rates } = mergeModel(options);
    const mediaDownload = dau * assumptions.mediaDownloadGiBPerDauMonth * rates.mediaDownloadGiB;
    const functionCompute = dau * assumptions.functionComputeCostPerDauMonth;
    const spark = dau * assumptions.sparkCostPerDauMonth;
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

export function monthlyCost(dau, options = {}) {
    const baseOps = monthlyBaseOpsCost(dau, options);
    const retention = monthlyRetentionCost(dau, options);
    const auth = monthlyAuthCost(dau, options);
    const extras = monthlyExtraCost(dau, options);
    const total = baseOps.total + retention.total + auth.total + extras.total;

    return {
        dau,
        baseOps,
        retention,
        auth,
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

function cliOptions() {
    return {
        assumptions: {
            daysPerMonth: readNumberEnv('DAYS_PER_MONTH', DEFAULT_ASSUMPTIONS.daysPerMonth),
            retainedSavedDays: readNumberEnv('RETAINED_SAVED_DAYS', DEFAULT_ASSUMPTIONS.retainedSavedDays),
            monthlyActiveUsersPerDau: readNumberEnv('MAU_PER_DAU', DEFAULT_ASSUMPTIONS.monthlyActiveUsersPerDau),
            averageMediaMiB: readNumberEnv('MEDIA_MIB', DEFAULT_ASSUMPTIONS.averageMediaMiB),
            averageAvatarKiB: readNumberEnv('AVATAR_KIB', DEFAULT_ASSUMPTIONS.averageAvatarKiB),
            avatarUploadRate: readNumberEnv('AVATAR_UPLOAD_RATE', DEFAULT_ASSUMPTIONS.avatarUploadRate),
            savedTextMessageRate: readNumberEnv('SAVED_TEXT_RATE', DEFAULT_ASSUMPTIONS.savedTextMessageRate),
            savedMediaMessageRate: readNumberEnv('SAVED_MEDIA_RATE', DEFAULT_ASSUMPTIONS.savedMediaMessageRate),
            mediaDownloadGiBPerDauMonth: readNumberEnv('MEDIA_DOWNLOAD_GIB_PER_DAU_MONTH', DEFAULT_ASSUMPTIONS.mediaDownloadGiBPerDauMonth),
            functionComputeCostPerDauMonth: readNumberEnv('FUNCTION_COMPUTE_COST_PER_DAU_MONTH', DEFAULT_ASSUMPTIONS.functionComputeCostPerDauMonth),
            sparkCostPerDauMonth: readNumberEnv('SPARK_COST_PER_DAU_MONTH', DEFAULT_ASSUMPTIONS.sparkCostPerDauMonth),
            moderationLaborCostMonth: readNumberEnv('MODERATION_COST_MONTH', DEFAULT_ASSUMPTIONS.moderationLaborCostMonth),
        },
        rates: {
            mediaDownloadGiB: readNumberEnv('MEDIA_DOWNLOAD_GIB_COST', DEFAULT_RATES.mediaDownloadGiB),
        },
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const dau = readNumberEnv('DAU', 1000000);
    const options = cliOptions();
    console.log(JSON.stringify(monthlyCost(dau, options), null, 2));
}
