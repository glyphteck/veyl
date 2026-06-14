'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Field } from '@/components/field';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { MoneyAmountInput } from '@/components/moneyamountinput';
import { ArrowRight, Loader, PiggyBank, CircleCheck, ScanQrCode } from 'lucide-react';
import { Bitcoin } from '@/components/bitcoin';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { MONEY_UNITS, toSats, toDisplay, renderMoney } from '@veyl/shared/money';
import { truncateAddress } from '@veyl/shared/utils/display';
import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES, formatOnchainFeeAmount, getWithdrawalFeeRisk } from '@veyl/shared/wallet/fees';
import { getWithdrawalReviewAmounts } from '@veyl/shared/wallet/withdraw';
import { availableBalanceSats } from '@veyl/shared/wallet/balance';
import { isAddressOnNetwork, isMainnet } from '@veyl/shared/network';
import { toast } from 'sonner';

export default function Withdraw({ data, close }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [review, setReview] = useState(null);
    const router = useRouter();
    const bitcoin = useBitcoin();
    const { openDialog } = useDialog();
    const { balance, prepareWithdrawal, confirmWithdrawal, network } = useWallet();
    const { settings } = useUser();
    const { cloaked } = useCloak();
    const amountInputRef = useRef(null);

    const schema = (max, price, network) =>
        z
            .object({
                receivingAddress: z
                    .string()
                    .min(1, 'receiving address required')
                    .refine((v) => isAddressOnNetwork(v, network), {
                        message: isMainnet(network) ? 'not a mainnet address' : 'not a regtest address',
                    }),
                inputUnit: z.enum(MONEY_UNITS),
                amount: z.string().regex(/^\d+(\.\d{0,8})?$/, 'invalid number'),
            })
            .superRefine((data, ctx) => {
                const maxSats = availableBalanceSats(max);
                let sats;
                try {
                    sats = toSats(data.amount, data.inputUnit, price);
                } catch {
                    ctx.addIssue({
                        path: ['amount'],
                        code: 'custom',
                        message: 'invalid amount',
                    });
                    return;
                }

                if (sats <= 0n) {
                    ctx.addIssue({
                        path: ['amount'],
                        code: 'custom',
                        message: 'amount must be more than 0 sats',
                    });
                } else if (sats > maxSats) {
                    ctx.addIssue({
                        path: ['amount'],
                        code: 'custom',
                        message: `amount 1-${maxSats.toString()} sats`,
                    });
                } else {
                    data.amount = sats;
                }
            })
            .transform((d) => ({ ...d, amount: d.amount }));

    const resolver = useMemo(() => zodResolver(schema(balance, bitcoin.price, network)), [balance, bitcoin.price, network]);

    const form = useForm({
        resolver,
        defaultValues: {
            receivingAddress: data?.receivingAddress || data?.address || '',
            amount: data?.amount || '',
            inputUnit: data?.inputUnit || settings.moneyFormat,
        },
    });
    const watchedAmount = form.watch('amount');
    const watchedInputUnit = form.watch('inputUnit');
    const watchedAddress = form.watch('receivingAddress');
    const balanceSats = useMemo(() => availableBalanceSats(balance), [balance]);
    const addressOnNetwork = watchedAddress && isAddressOnNetwork(watchedAddress, network);
    const enteredSats = useMemo(() => {
        if (!watchedAmount) return 0n;
        try {
            return toSats(watchedAmount, watchedInputUnit, bitcoin.price);
        } catch {
            return 0n;
        }
    }, [watchedAmount, watchedInputUnit, bitcoin.price]);
    const amountAboveBalance = enteredSats > balanceSats;
    const feeEstimate = useMemo(() => {
        const estimate = bitcoin.estimateTransactionFees({
            speed: 'medium',
            vbytes: COOPERATIVE_EXIT_TX_VBYTES,
            baseSats: COOPERATIVE_EXIT_FLAT_FEE_SATS,
        });
        return estimate?.success ? estimate.onchainEstimate : null;
    }, [bitcoin]);
    const feeAmountSats = feeEstimate?.feeAmountSats ?? null;
    const reviewAmounts = useMemo(() => {
        if (!review) return null;
        try {
            return getWithdrawalReviewAmounts(review);
        } catch {
            return null;
        }
    }, [review]);
    const withdrawalFeeRisk = useMemo(() => {
        if (!reviewAmounts) return null;
        return getWithdrawalFeeRisk({ amountSats: reviewAmounts.sendAmountSats, feeAmountSats: reviewAmounts.feeAmountSats });
    }, [reviewAmounts]);
    const feeWarning = withdrawalFeeRisk?.high;
    const estimatedWithdrawalFeeRisk = useMemo(
        () => getWithdrawalFeeRisk({ amountSats: enteredSats > 0n ? enteredSats : balanceSats, feeAmountSats }),
        [balanceSats, enteredSats, feeAmountSats]
    );
    const estimateFeeWarning = estimatedWithdrawalFeeRisk?.high;
    const reviewAddress = review?.onchainAddress || '';
    const sendText = reviewAmounts ? renderMoney(reviewAmounts.sendAmountSats, settings.moneyFormat, bitcoin.price) : '';
    const receiveText = reviewAmounts ? renderMoney(reviewAmounts.receiveAmountSats, settings.moneyFormat, bitcoin.price) : '';
    const feeText = reviewAmounts ? renderMoney(reviewAmounts.feeAmountSats, settings.moneyFormat, bitcoin.price) : '';
    const estimateText = formatOnchainFeeAmount(feeEstimate, settings?.moneyFormat, bitcoin.price);
    const hasFeeEstimate = feeAmountSats != null;
    const buttonFeedback = !review && amountAboveBalance ? 'amount is above your balance' : '';
    const reviewAddressLabel = truncateAddress(reviewAddress, 10, 8);
    const reviewActionAddress = truncateAddress(reviewAddress, 8, 8);

    const setUnit = useCallback(
        (u) => {
            if (!u) return;
            const currentUnit = form.getValues('inputUnit');
            if (u === currentUnit) return;
            const currentAmount = form.getValues('amount');
            if (currentAmount) {
                const sats = toSats(currentAmount, currentUnit, bitcoin.price);
                form.setValue('inputUnit', u);
                if (sats === 0n) {
                    form.setValue('amount', '');
                } else {
                    form.setValue('amount', toDisplay(sats, u, bitcoin.price));
                }
            } else {
                form.setValue('inputUnit', u);
            }
            if (amountInputRef.current) {
                amountInputRef.current.focus();
            }
        },
        [form, bitcoin.price]
    );

    const cycleUnit = useCallback(() => {
        const currentUnit = form.getValues('inputUnit');
        const index = MONEY_UNITS.indexOf(currentUnit);
        setUnit(MONEY_UNITS[(index + 1) % MONEY_UNITS.length]);
    }, [form, setUnit]);

    const setAmount = useCallback(
        (raw) => {
            const unit = form.getValues('inputUnit');
            const max = availableBalanceSats(balance);
            const accept = (regex, ok) => {
                if (regex.test(raw) && ok()) form.setValue('amount', raw);
            };
            if (unit === 'sats') {
                const isValidSats = raw === '' || (!/^0+$/.test(raw) && !/^0\d/.test(raw));
                accept(/^\d{0,16}$/, () => isValidSats && BigInt(raw || 0) <= max);
            } else if (unit === 'btc') {
                accept(/^\d{0,8}(\.\d{0,8})?$/, () => toSats(raw, 'btc', bitcoin.price) <= max);
            } else if (unit === 'usd') {
                const isValidUsd = raw === '' || !/^0\d/.test(raw);
                accept(/^\d{0,8}(\.\d{0,4})?$/, () => isValidUsd && (raw === '' || toSats(raw, 'usd', bitcoin.price) <= max));
            }
        },
        [form, balance, bitcoin.price]
    );

    const handleAmountChange = useCallback(
        (e) => {
            setAmount(e.target.value);
        },
        [setAmount]
    );

    const setMax = useCallback(() => {
        const unit = form.getValues('inputUnit');
        form.setValue('amount', toDisplay(balanceSats, unit, bitcoin.price));
    }, [form, balanceSats, bitcoin.price]);

    const openWithdrawalInfo = useCallback(() => {
        const values = form.getValues();
        openDialog('withdrawalinfo', {
            withdraw: {
                receivingAddress: values.receivingAddress || '',
                amount: values.amount || '',
                inputUnit: values.inputUnit || settings.moneyFormat,
            },
        });
    }, [form, openDialog, settings.moneyFormat]);

    useEffect(() => {
        form.clearErrors();
    }, [balance, form]);

    useEffect(() => {
        setReview(null);
    }, [watchedAddress, watchedAmount, watchedInputUnit]);

    useEffect(() => {
        if (data?.address) {
            form.setValue('receivingAddress', data.address);
            setReview(null);
        }
    }, [data?.address, form]);

    useEffect(() => {
        amountInputRef.current?.focus({ preventScroll: true });
    }, []);

    const onSubmit = useCallback(
        async (data) => {
            setIsSubmitting(true);
            const result = await prepareWithdrawal({
                onchainAddress: data.receivingAddress,
                amountSats: data.amount,
                exitSpeed: 'MEDIUM',
            });
            if (result.success) {
                setReview(result.withdrawal);
            } else {
                toast.error(result.error?.message || 'failed to prepare withdrawal');
            }
            setIsSubmitting(false);
        },
        [prepareWithdrawal]
    );

    const onConfirm = useCallback(async () => {
        if (!review) return;

        setIsSubmitting(true);
        const result = await confirmWithdrawal(review);
        if (result.success) {
            const displayAmount = renderMoney(reviewAmounts?.sendAmountSats ?? review.amountSats, settings.moneyFormat, bitcoin.price);
            const addressDisplay = truncateAddress(review.onchainAddress);
            toast(`Withdrew ${displayAmount} to ${addressDisplay}`, {
                icon: <CircleCheck />,
            });
            form.reset();
            setReview(null);
            setIsSubmitting(false);
            close();
            return;
        } else {
            toast.error(result.error?.message || 'failed to withdraw');
        }
        setIsSubmitting(false);
    }, [bitcoin.price, close, confirmWithdrawal, form, review, reviewAmounts?.sendAmountSats, settings.moneyFormat]);

    const copyReviewAddress = useCallback(async () => {
        if (!reviewAddress) return;
        try {
            await navigator.clipboard.writeText(reviewAddress);
            toast('address copied', { icon: <CircleCheck /> });
        } catch {
            toast.error('could not copy address');
        }
    }, [reviewAddress]);

    const canSubmit =
        !isSubmitting &&
        !review &&
        watchedAddress &&
        addressOnNetwork &&
        watchedAmount &&
        enteredSats > 0n &&
        enteredSats <= balanceSats;

    const canConfirm = !isSubmitting && !!review && !!reviewAmounts;

    const buttonLabel = review ? `send to ${reviewActionAddress}` : buttonFeedback || 'withdraw';

    const renderReview = () => (
        <div className="flex flex-col gap-2">
            <Button type="button" className="group button-outline relative flex h-16 w-full min-w-0 justify-start gap-3.5 overflow-visible rounded-full px-3 py-1.5 text-left" onClick={copyReviewAddress} title="copy address">
                <span className="grower flex size-12 shrink-0 items-center justify-center">
                    <Bitcoin className="size-10" />
                </span>
                <div className="min-w-0 flex-1">
                    <div title={reviewAddress} className="min-w-0 truncate text-3xl leading-8 font-black text-foreground">
                        {reviewAddressLabel}
                    </div>
                    <div
                        className="pointer-events-none absolute top-full left-3 z-20 mt-1 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-background/90 px-2 py-1 text-[10px] leading-3 font-black text-muted opacity-0 shadow backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        title={reviewAddress}
                    >
                        {reviewAddress}
                    </div>
                </div>
            </Button>
            <div className="rounded-round bg-background/70 p-4 shadow backdrop-blur-sm">
                <div className="flex min-w-0 items-center gap-3.5">
                    <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(7rem,auto)_minmax(0,1fr)] items-center gap-4">
                        <div className="min-w-0">
                            <div className="text-sm font-black text-muted">withdraw</div>
                            <div className={`mt-1 min-w-0 truncate text-4xl leading-none font-black text-foreground ${cloaked ? 'cloaked' : ''}`}>{sendText}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-center gap-1 px-1">
                            <div className={`text-3xl leading-none font-black ${feeWarning ? 'text-destructive' : 'text-foreground'} ${cloaked ? 'cloaked' : ''}`}>{feeText}</div>
                            <div className="text-[11px] leading-3 font-black text-muted">fee</div>
                            <ArrowRight className="mt-1 size-7 text-muted" />
                        </div>
                        <div className="min-w-0 text-right">
                            <div className="text-sm font-black text-muted">receive</div>
                            <div className={`mt-1 min-w-0 truncate text-4xl leading-none font-black text-foreground ${cloaked ? 'cloaked' : ''}`}>{receiveText}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex w-md max-w-[calc(100vw-2rem)] flex-col gap-2">
            <form id="withdraw-funds-form" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-1">
                {review ? (
                    renderReview()
                ) : (
                    <>
                        <div className="flex justify-start">
                            <Button
                                tabIndex={-1}
                                className={`grower-sm min-w-0 max-w-full justify-start p-0 text-base font-black ${estimateFeeWarning ? 'text-destructive' : 'text-foreground'}`}
                                type="button"
                                onClick={openWithdrawalInfo}
                                disabled={isSubmitting}
                                title="withdrawal fee info"
                            >
                                <span className="min-w-0 truncate whitespace-nowrap">estimated fee: {hasFeeEstimate ? '~' : ''}{estimateText}</span>
                            </Button>
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
                            <Field
                                control={form.control}
                                name="receivingAddress"
                                render={({ field, inputProps }) => (
                                    <Input {...field} {...inputProps} className="h-12 min-w-0 pl-4 pr-4 text-lg font-black" placeholder="receiving address" disabled={isSubmitting} />
                                )}
                            />
                            <Button
                                tabIndex={-1}
                                className="grower-lg h-12 w-14"
                                type="button"
                                onClick={() => {
                                    close();
                                    router.push('/camera');
                                }}
                                disabled={isSubmitting}
                                title="scan"
                            >
                                <ScanQrCode className="size-8" />
                            </Button>
                            <Field
                                control={form.control}
                                name="amount"
                                render={({ field, inputProps }) => (
                                    <MoneyAmountInput
                                        {...field}
                                        {...inputProps}
                                        ref={(el) => {
                                            field.ref(el);
                                            amountInputRef.current = el;
                                        }}
                                        unit={watchedInputUnit}
                                        onCycleUnit={cycleUnit}
                                        onChange={handleAmountChange}
                                        disabled={isSubmitting}
                                        cloaked={cloaked}
                                    />
                                )}
                            />
                            <Button tabIndex={-1} className="grower-lg h-12 w-14" type="button" onClick={setMax} disabled={isSubmitting} title="max">
                                <PiggyBank className="size-8 stroke-2" />
                            </Button>
                        </div>
                    </>
                )}
            </form>
            <div>
                <Button
                    type={review ? 'button' : 'submit'}
                    form={review ? undefined : 'withdraw-funds-form'}
                    onClick={review ? onConfirm : undefined}
                    className={`${buttonFeedback ? 'button-destructive' : 'button-fill'} shrinker w-full`}
                    disabled={review ? !canConfirm : !canSubmit}
                >
                    {isSubmitting ? <Loader className="animate-spin" /> : buttonLabel}
                </Button>
            </div>
        </div>
    );
}
