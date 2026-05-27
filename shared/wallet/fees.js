export const DEFAULT_EXIT_SPEED = 'MEDIUM';
export const EXIT_SPEEDS = Object.freeze(['SLOW', 'MEDIUM', 'FAST']);
export const COOPERATIVE_EXIT_TX_VBYTES = 250;
export const COOPERATIVE_EXIT_FLAT_FEE_SATS = 750;
export const FUNDING_TX_PREVIEW_VBYTES = 200;
export const STATIC_DEPOSIT_CLAIM_FEE_SATS = 99;
export const UNILATERAL_EXIT_MIN_LEAF_SATS = 16348n;
export const UNILATERAL_EXIT_PARENT_TX_FALLBACK_VBYTES = 191;
export const UNILATERAL_EXIT_FEE_BUMP_TX_VBYTES = 151;
export const UNILATERAL_EXIT_PACKAGES_PER_LEAF = 2;
export const UNILATERAL_EXIT_PREVIEW_VBYTES = UNILATERAL_EXIT_PACKAGES_PER_LEAF * (UNILATERAL_EXIT_PARENT_TX_FALLBACK_VBYTES + UNILATERAL_EXIT_FEE_BUMP_TX_VBYTES);
export const WITHDRAWAL_FEE_WARNING_RATIO = 0.25;
const DEFAULT_FEE_RATE_SPEED = 'medium';

const FEE_RATE_FALLBACKS = Object.freeze({
    default: Object.freeze(['medium', 'low', 'high']),
    high: Object.freeze(['high', 'medium', 'low']),
    fastest: Object.freeze(['high', 'medium', 'low']),
    medium: Object.freeze(['medium', 'low', 'high']),
    halfHour: Object.freeze(['medium', 'high', 'low']),
    hour: Object.freeze(['medium', 'low', 'high']),
    low: Object.freeze(['low', 'medium', 'high']),
    economy: Object.freeze(['low', 'medium', 'high']),
    minimum: Object.freeze(['low', 'medium', 'high']),
    noPriority: Object.freeze(['low', 'medium', 'high']),
    average: Object.freeze(['medium', 'low', 'high']),
});

const WITHDRAWAL_FEE_FIELDS = Object.freeze({
    FAST: Object.freeze({ user: 'userFeeFast', l1: 'l1BroadcastFeeFast' }),
    MEDIUM: Object.freeze({ user: 'userFeeMedium', l1: 'l1BroadcastFeeMedium' }),
    SLOW: Object.freeze({ user: 'userFeeSlow', l1: 'l1BroadcastFeeSlow' }),
});

function getOptionalSats(value) {
    if (value == null) {
        return null;
    }

    const n = typeof value === 'bigint' ? Number(value) : Number(value);
    if (!Number.isSafeInteger(n) || n < 0) {
        return null;
    }
    return n;
}

export function toSafeSats(value, label = 'amountSats') {
    const n = getOptionalSats(value);
    if (n == null || n <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
    return n;
}

export function toSafeNonNegativeSats(value, label = 'amountSats') {
    const n = getOptionalSats(value);
    if (n == null) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
    return n;
}

export function getExitSpeed(value = DEFAULT_EXIT_SPEED) {
    const speed = String(value || DEFAULT_EXIT_SPEED).toUpperCase();
    if (!EXIT_SPEEDS.includes(speed)) {
        throw new Error('invalid exit speed');
    }
    return speed;
}

export function getCurrencyAmountSats(amount) {
    const value = getOptionalSats(amount?.originalValue);
    if (value == null) {
        return 0;
    }

    if (amount?.originalUnit === 'MILLISATOSHI') {
        return Math.ceil(value / 1000);
    }

    return value;
}

export function getWithdrawalFeeBreakdown(feeQuote, exitSpeed = DEFAULT_EXIT_SPEED) {
    if (!feeQuote) {
        return null;
    }

    const speed = getExitSpeed(exitSpeed);
    const fields = WITHDRAWAL_FEE_FIELDS[speed];
    const userFeeSats = getCurrencyAmountSats(feeQuote[fields.user]);
    const l1BroadcastFeeSats = getCurrencyAmountSats(feeQuote[fields.l1]);

    return {
        speed,
        userFeeSats,
        l1BroadcastFeeSats,
        feeAmountSats: userFeeSats + l1BroadcastFeeSats,
        quoteId: feeQuote.id ?? null,
        expiresAt: feeQuote.expiresAt ?? null,
    };
}

export function getWithdrawalFeeAmountSats(feeQuote, exitSpeed = DEFAULT_EXIT_SPEED) {
    return getWithdrawalFeeBreakdown(feeQuote, exitSpeed)?.feeAmountSats ?? null;
}

export function normalizeWithdrawalFeeQuote(feeQuote) {
    if (!feeQuote) {
        return null;
    }

    const speeds = {};
    for (const speed of EXIT_SPEEDS) {
        speeds[speed] = getWithdrawalFeeBreakdown(feeQuote, speed);
    }

    return {
        id: feeQuote.id ?? null,
        expiresAt: feeQuote.expiresAt ?? null,
        network: feeQuote.network ?? null,
        totalAmountSats: getCurrencyAmountSats(feeQuote.totalAmount),
        speeds,
        raw: feeQuote,
    };
}

export function getStaticDepositClaimFeeSats({ depositAmountSats, creditAmountSats } = {}) {
    const depositAmount = getOptionalSats(depositAmountSats);
    const creditAmount = getOptionalSats(creditAmountSats);
    if (depositAmount == null || creditAmount == null) {
        return null;
    }

    return Math.max(0, depositAmount - creditAmount);
}

export function normalizeStaticDepositQuote(quote, deposit = {}) {
    if (!quote) {
        return null;
    }

    const creditAmountSats = getOptionalSats(quote.creditAmountSats);
    const depositAmountSats = getOptionalSats(deposit.amountSats ?? deposit.depositAmountSats);

    return {
        transactionId: quote.transactionId ?? deposit.transactionId ?? deposit.txid ?? null,
        outputIndex: quote.outputIndex ?? deposit.outputIndex ?? deposit.vout ?? null,
        address: deposit.address ?? null,
        confirmed: deposit.isConfirmed ?? deposit.confirmed ?? null,
        network: quote.network ?? null,
        creditAmountSats,
        feeAmountSats: getStaticDepositClaimFeeSats({ depositAmountSats, creditAmountSats }),
        raw: quote,
    };
}

export function getFeeRateSatsPerVbyte(bitcoin, speed = DEFAULT_FEE_RATE_SPEED) {
    const rates = bitcoin?.fees?.satPerVbyte;
    const key = String(speed || DEFAULT_FEE_RATE_SPEED);
    const keys = FEE_RATE_FALLBACKS[key] ?? [key, ...FEE_RATE_FALLBACKS.default];

    for (const rateKey of keys) {
        const rate = Number(rates?.[rateKey]);
        if (Number.isFinite(rate) && rate >= 0) {
            return rate;
        }
    }

    return null;
}

export function weightUnitsToVbytes(weightUnits) {
    const weight = Number(weightUnits);
    return Number.isFinite(weight) && weight > 0 ? Math.ceil(weight / 4) : null;
}

export function getExpectedVbytes({ vbytes, weightUnits } = {}) {
    const readyVbytes = Number(vbytes);
    if (Number.isFinite(readyVbytes) && readyVbytes > 0) {
        return Math.ceil(readyVbytes);
    }
    return weightUnitsToVbytes(weightUnits);
}

export function estimateOnchainFeeSats({ bitcoin, feeRate, speed = DEFAULT_FEE_RATE_SPEED, vbytes, weightUnits, baseSats = 0 } = {}) {
    const readyFeeRate = feeRate ?? getFeeRateSatsPerVbyte(bitcoin, speed);
    const readyVbytes = getExpectedVbytes({ vbytes, weightUnits });
    if (!Number.isFinite(readyFeeRate) || readyFeeRate < 0 || readyVbytes == null || !Number.isFinite(baseSats) || baseSats < 0) {
        return null;
    }
    return Math.ceil(readyVbytes * readyFeeRate + baseSats);
}

export function normalizeOnchainFeeEstimate({ bitcoin, feeRate, speed = DEFAULT_FEE_RATE_SPEED, vbytes, weightUnits, baseSats = 0 } = {}) {
    const feeRateSatsPerVbyte = feeRate ?? getFeeRateSatsPerVbyte(bitcoin, speed);
    const expectedVbytes = getExpectedVbytes({ vbytes, weightUnits });
    const feeAmountSats = estimateOnchainFeeSats({ bitcoin, feeRate, speed, vbytes, weightUnits, baseSats });
    if (feeAmountSats == null) {
        return null;
    }

    return {
        feeAmountSats,
        feeRateSatsPerVbyte,
        speed,
        vbytes: expectedVbytes,
        weightUnits: Number.isFinite(Number(weightUnits)) && Number(weightUnits) > 0 ? Math.ceil(Number(weightUnits)) : null,
        baseSats,
        source: feeRate == null ? (bitcoin?.fees?.source ?? null) : 'manual',
        updatedAtIso: bitcoin?.fees?.updatedAtIso ?? null,
    };
}

function getPositiveCount(value, fallback = 1) {
    const count = Number(value ?? fallback);
    return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export function estimateUnilateralExitFeeSats({ bitcoin, feeRate, speed = DEFAULT_FEE_RATE_SPEED, leaves = 1, baseSats = 0 } = {}) {
    const leafCount = getPositiveCount(leaves);
    if (leafCount == null) {
        return null;
    }
    return estimateOnchainFeeSats({
        bitcoin,
        feeRate,
        speed,
        vbytes: UNILATERAL_EXIT_PREVIEW_VBYTES * leafCount,
        baseSats,
    });
}

export function normalizeUnilateralExitFeeEstimate({ bitcoin, feeRate, speed = DEFAULT_FEE_RATE_SPEED, leaves = 1, baseSats = 0 } = {}) {
    const leafCount = getPositiveCount(leaves);
    if (leafCount == null) {
        return null;
    }

    const estimate = normalizeOnchainFeeEstimate({
        bitcoin,
        feeRate,
        speed,
        vbytes: UNILATERAL_EXIT_PREVIEW_VBYTES * leafCount,
        baseSats,
    });
    if (!estimate) {
        return null;
    }

    return {
        ...estimate,
        kind: 'unilateral_exit',
        leaves: leafCount,
        vbytesPerLeaf: UNILATERAL_EXIT_PREVIEW_VBYTES,
    };
}

export function getWithdrawalFeeRisk({ amountSats, feeAmountSats, warningRatio = WITHDRAWAL_FEE_WARNING_RATIO } = {}) {
    const amount = getOptionalSats(amountSats);
    const fee = getOptionalSats(feeAmountSats);
    if (amount == null || amount <= 0 || fee == null) {
        return null;
    }

    const feeRatio = fee / amount;
    const feeExceedsAmount = fee >= amount;
    const feeIsLarge = feeRatio >= warningRatio;

    return {
        feeRatio,
        feeExceedsAmount,
        feeIsLarge,
        high: feeExceedsAmount || feeIsLarge,
    };
}

export function normalizeLightningFeeEstimate(feeAmountSats) {
    return {
        feeAmountSats: toSafeNonNegativeSats(feeAmountSats, 'feeAmountSats'),
    };
}

export function normalizeLightningReceiveRequest(request) {
    if (!request) {
        return null;
    }

    const invoice = request.invoice ?? null;
    return {
        id: request.id ?? null,
        status: request.status ?? null,
        network: request.network ?? invoice?.bitcoinNetwork ?? null,
        createdAt: request.createdAt ?? invoice?.createdAt ?? null,
        updatedAt: request.updatedAt ?? null,
        expiresAt: invoice?.expiresAt ?? null,
        amountSats: getCurrencyAmountSats(invoice?.amount),
        encodedInvoice: invoice?.encodedInvoice ?? null,
        paymentHash: invoice?.paymentHash ?? null,
        sparkInvoice: request.sparkInvoice ?? null,
        transfer: request.transfer ?? null,
        raw: request,
    };
}

export function normalizeLightningPaymentResult(result) {
    if (!result) {
        return null;
    }

    if (result.encodedInvoice || result.fee || String(result.typename || '').includes('LightningSendRequest')) {
        return {
            kind: 'lightning',
            id: result.id ?? null,
            status: result.status ?? null,
            network: result.network ?? null,
            encodedInvoice: result.encodedInvoice ?? null,
            feeAmountSats: getCurrencyAmountSats(result.fee),
            idempotencyKey: result.idempotencyKey ?? null,
            transfer: result.transfer ?? null,
            raw: result,
        };
    }

    return {
        kind: 'spark',
        id: result.id ?? null,
        status: result.status ?? null,
        transfer: result,
        raw: result,
    };
}
