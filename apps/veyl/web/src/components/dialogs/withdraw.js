'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Field } from '@/components/field';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { Loader, PiggyBank, CircleCheck, ScanQrCode } from 'lucide-react';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { toSats, toDisplay, truncateAddress, renderMoney } from '@/lib/utils';
import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES, formatOnchainFeeAmount, getWithdrawalFeeRisk } from '@glyphteck/shared/wallet/fees';
import { isAddressOnNetwork, isMainnet } from '@glyphteck/shared/network';
import { toast } from 'sonner';

function balanceToSats(balance) {
    const value = Number(balance ?? 0);
    return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
}

const MONEY_UNITS = ['sats', 'btc', 'usd'];

function unitLabel(unit) {
    if (unit === 'btc') return '₿';
    if (unit === 'usd') return '$';
    return 'sats';
}

export default function Withdraw({ data, close }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();
    const bitcoin = useBitcoin();
    const { openDialog } = useDialog();
    const { balance, withdrawFunds, network } = useWallet();
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
                inputUnit: z.enum(['sats', 'btc', 'usd']),
                amount: z.string().regex(/^\d+(\.\d{0,8})?$/, 'invalid number'),
            })
            .superRefine((data, ctx) => {
                const maxSats = balanceToSats(max);
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
    const balanceSats = useMemo(() => balanceToSats(balance), [balance]);
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
    const withdrawalFeeRisk = useMemo(
        () => getWithdrawalFeeRisk({ amountSats: enteredSats > 0n ? enteredSats : balanceSats, feeAmountSats }),
        [balanceSats, enteredSats, feeAmountSats]
    );
    const feeWarning = withdrawalFeeRisk?.high;
    const feeText = formatOnchainFeeAmount(feeEstimate, settings?.moneyFormat, bitcoin.price);
    const buttonFeedback = amountAboveBalance ? 'amount is above your balance' : '';

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
            const max = balanceToSats(balance);
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
        if (data?.address) {
            form.setValue('receivingAddress', data.address);
        }
    }, [data?.address, form]);

    useEffect(() => {
        amountInputRef.current?.focus({ preventScroll: true });
    }, []);

    const onSubmit = useCallback(
        async (data) => {
            setIsSubmitting(true);
            const displayAmount = renderMoney(data.amount.toString(), settings.moneyFormat, bitcoin.price);
            const addressDisplay = truncateAddress(data.receivingAddress);
            close();
            const result = await withdrawFunds({
                onchainAddress: data.receivingAddress,
                amountSats: Number(data.amount),
                exitSpeed: 'MEDIUM',
            });
            if (result.success) {
                toast(`Withdrew ${displayAmount} to ${addressDisplay}`, {
                    icon: <CircleCheck />,
                });
                form.reset();
            }
            setIsSubmitting(false);
        },
        [bitcoin.price, close, form, settings.moneyFormat, withdrawFunds]
    );

    return (
        <div className="w-md max-w-full flex flex-col gap-2">
            <form id="withdraw-funds-form" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-1">
                <div className="flex justify-start">
                    <Button
                        tabIndex={-1}
                        className={`grower-sm min-w-0 max-w-full justify-start p-0 text-base font-black ${feeWarning ? 'text-destructive' : 'text-foreground'}`}
                        type="button"
                        onClick={openWithdrawalInfo}
                        disabled={isSubmitting}
                        title="withdrawal fee info"
                    >
                        <span className="min-w-0 truncate whitespace-nowrap">estimated fee: ~{feeText}</span>
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
                            <div className="relative w-full">
                                <Input
                                    {...field}
                                    {...inputProps}
                                    ref={(el) => {
                                        field.ref(el);
                                        amountInputRef.current = el;
                                    }}
                                    className={`h-12 min-w-0 pl-4 pr-20 text-2xl font-black ${cloaked ? 'cloaked' : ''}`}
                                    placeholder={watchedInputUnit === 'sats' ? '0000' : '0.00'}
                                    onChange={handleAmountChange}
                                    inputMode="numeric"
                                    pattern={watchedInputUnit === 'sats' ? '[0-9]*' : '[0-9.]*'}
                                    disabled={isSubmitting}
                                />
                                <Button
                                    type="button"
                                    aria-label={`change currency, current ${watchedInputUnit}`}
                                    title="change currency"
                                    className="grower-lg absolute top-1/2 right-3 h-9 min-w-12 -translate-y-1/2 justify-end px-2.5 text-2xl font-black text-muted"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={cycleUnit}
                                    disabled={isSubmitting}
                                >
                                    {unitLabel(watchedInputUnit)}
                                </Button>
                            </div>
                        )}
                    />
                    <Button tabIndex={-1} className="grower-lg h-12 w-14" type="button" onClick={setMax} disabled={isSubmitting} title="max">
                        <PiggyBank className="size-8 stroke-2" />
                    </Button>
                </div>
            </form>
            <Button
                type="submit"
                form="withdraw-funds-form"
                className={`${buttonFeedback ? 'button-destructive' : 'button-outline'} shrinker`}
                disabled={
                    isSubmitting ||
                    !watchedAddress ||
                    !addressOnNetwork ||
                    !watchedAmount ||
                    enteredSats <= 0n ||
                    enteredSats > balanceSats
                }
            >
                {isSubmitting ? <Loader className="animate-spin" /> : buttonFeedback || 'withdraw'}
            </Button>
        </div>
    );
}
