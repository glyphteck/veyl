'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card } from '@/components/card';
import { Field } from '@/components/field';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/togglegroup';
import { Rabbit, Turtle, Snail, Loader, PiggyBank, CircleCheck, ScanQrCode, CircleQuestionMark } from 'lucide-react';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { toSats, toDisplay, truncateAddress, renderMoney } from '@/lib/utils';
import { COOPERATIVE_EXIT_FLAT_FEE_SATS, COOPERATIVE_EXIT_TX_VBYTES, getWithdrawalFeeRisk } from '@glyphteck/shared/wallet/fees';
import { isAddressOnNetwork, isMainnet } from '@glyphteck/shared/network';
import { toast } from 'sonner';

function balanceToSats(balance) {
    const value = Number(balance ?? 0);
    return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
}

function formatWholeNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatSats(value) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0) return 'updating';
    return `${formatWholeNumber(amount)} ${amount === 1 ? 'sat' : 'sats'}`;
}

function formatFeeAmount(value, moneyFormat, price) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'updating';
    return renderMoney(Math.max(0, Math.ceil(amount)), moneyFormat || 'sats', price);
}

function formatFeeRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return 'updating';
    const rounded = Math.round(rate * 1000) / 1000;
    return `${rounded >= 10 ? formatWholeNumber(Math.round(rounded)) : String(rounded)} sat/vB`;
}

export default function Withdraw({ data, close }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showFeeInfo, setShowFeeInfo] = useState(false);
    const router = useRouter();
    const bitcoin = useBitcoin();
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
                exitSpeed: z.enum(['FAST', 'MEDIUM', 'SLOW']),
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
            receivingAddress: data?.address || '',
            amount: '',
            inputUnit: settings.moneyFormat,
            exitSpeed: 'MEDIUM',
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
    const feeText = feeAmountSats != null ? formatFeeAmount(feeAmountSats, settings?.moneyFormat, bitcoin.price) : 'updating';
    const buttonFeedback = amountAboveBalance ? 'amount is above your balance' : '';
    const feeFormula = `${feeEstimate?.vbytes ?? COOPERATIVE_EXIT_TX_VBYTES} vB x ${formatFeeRate(feeEstimate?.feeRateSatsPerVbyte)} + ${formatSats(COOPERATIVE_EXIT_FLAT_FEE_SATS)} = ${formatSats(feeAmountSats)}`;

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
                exitSpeed: data.exitSpeed,
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
        <div className="w-lg flex flex-col gap-2">
            <Card>
                <div hidden className="flex items-start justify-between px-4 pt-4 pb-10">
                    <div className="text-2xl leading-none font-black">withdraw funds</div>
                    <Field
                        control={form.control}
                        name="exitSpeed"
                        render={({ field, controlProps }) => (
                            <ToggleGroup
                                {...controlProps}
                                tabIndex={-1}
                                type="single"
                                value={field.value}
                                onValueChange={(val) => {
                                    if (val) field.onChange(val);
                                }}
                                disabled={isSubmitting}
                            >
                                <ToggleGroupItem value="SLOW" title="slow">
                                    <Snail className="stroke-2" />
                                </ToggleGroupItem>
                                <ToggleGroupItem value="MEDIUM" title="medium">
                                    <Turtle className="stroke-2" />
                                </ToggleGroupItem>
                                <ToggleGroupItem value="FAST" title="fast">
                                    <Rabbit className="stroke-2" />
                                </ToggleGroupItem>
                            </ToggleGroup>
                        )}
                    />
                </div>
                <div className="px-4 py-6">
                    <form id="withdraw-funds-form" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                        <div className="flex items-end justify-between gap-3 px-1">
                            <div className={`min-w-0 truncate text-sm font-black ${feeWarning ? 'text-destructive' : 'text-foreground'}`}>estimated fee: ~{feeText}</div>
                            <Button
                                tabIndex={-1}
                                className="grower-lg text-foreground"
                                type="button"
                                onClick={() => setShowFeeInfo((current) => !current)}
                                disabled={isSubmitting}
                                title="withdrawal fee info"
                            >
                                <CircleQuestionMark className="size-6" />
                            </Button>
                        </div>
                        {showFeeInfo ? (
                            <div className="rounded-round bg-background/70 px-4 py-3 text-sm leading-6 font-bold text-muted shadow backdrop-blur-sm">
                                <div>you can withdraw your funds back to any bitcoin address. bitcoin transactions are not free. validators need to get paid.</div>
                                <div className="pt-2 font-black text-foreground tabular-nums">{feeFormula}</div>
                                <div className="pt-2">
                                    the transaction fee is an estimate on how expensive it is to send bitcoin over the network at the moment, with an additional flat fee to export bitcoin off the spark network.
                                </div>
                            </div>
                        ) : null}
                        <Field
                            control={form.control}
                            name="receivingAddress"
                            render={({ field, inputProps }) => (
                                <div className="flex gap-2.5">
                                    <Input {...field} {...inputProps} className="flex-1" placeholder="receiving address" disabled={isSubmitting} />
                                    <Button
                                        tabIndex={-1}
                                        className="grower-lg"
                                        type="button"
                                        onClick={() => {
                                            close();
                                            router.push('/camera');
                                        }}
                                        disabled={isSubmitting}
                                    >
                                        <ScanQrCode className="size-6" />
                                    </Button>
                                </div>
                            )}
                        />
                        <Field
                            control={form.control}
                            name="amount"
                            render={({ field, inputProps }) => (
                                <div className="flex items-center gap-2.5">
                                    <Input
                                        {...field}
                                        {...inputProps}
                                        ref={(el) => {
                                            field.ref(el);
                                            amountInputRef.current = el;
                                        }}
                                        className={`w-54 ${cloaked ? 'cloaked' : ''}`}
                                        placeholder={watchedInputUnit === 'sats' ? '0000' : '0.00'}
                                        onChange={handleAmountChange}
                                        inputMode="numeric"
                                        pattern={watchedInputUnit === 'sats' ? '[0-9]*' : '[0-9.]*'}
                                        disabled={isSubmitting}
                                    />
                                    <Button tabIndex={-1} className="grower-lg hidden sm:block" type="button" onClick={setMax} disabled={isSubmitting}>
                                        <PiggyBank className="size-6 stroke-2" />
                                    </Button>
                                    <ToggleGroup tabIndex={-1} className="ml-auto" type="single" value={watchedInputUnit} onValueChange={setUnit} disabled={isSubmitting}>
                                        <ToggleGroupItem value="btc">₿</ToggleGroupItem>
                                        <ToggleGroupItem value="sats">sats</ToggleGroupItem>
                                        <ToggleGroupItem value="usd">$</ToggleGroupItem>
                                    </ToggleGroup>
                                </div>
                            )}
                        />
                    </form>
                </div>
            </Card>
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
