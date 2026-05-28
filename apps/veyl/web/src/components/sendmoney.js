import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@/components/field';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { Loader, Coins, ScanQrCode } from 'lucide-react';
import { formatUserDisplay, toSats, toDisplay, renderMoney } from '@/lib/utils';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { toast } from 'sonner';
import PeerSelector from '@/components/peerselector';

const MONEY_UNITS = ['sats', 'btc', 'usd'];

function unitLabel(unit) {
    if (unit === 'btc') return '₿';
    if (unit === 'usd') return '$';
    return 'sats';
}

export default function SendMoney({ peer, amount = '', inputUnit, onPeerChange, onAmountChange, onInputUnitChange }) {
    const [receiver, setReceiver] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, balance } = useWallet();
    const { settings, walletPK: currentUserWalletPK } = useUser();
    const { closeDialog } = useDialog();
    const router = useRouter();
    const { cloaked } = useCloak();
    const amountInputRef = useRef(null);
    const unit = inputUnit || settings.moneyFormat;
    const hasAmount = amount != null && amount !== '';
    const start = !peer ? 'peer' : !hasAmount ? 'amount' : null;

    const schema = (max, price, currentWalletPK) =>
        z
            .object({
                receiver: z.object({}).passthrough(),
                inputUnit: z.enum(['sats', 'btc', 'usd']),
                amount: z.string().regex(/^\d+(\.\d{0,8})?$/, 'invalid number'),
            })
            .superRefine((data, ctx) => {
                if (!data.receiver?.walletPK) {
                    ctx.addIssue({
                        path: ['receiver'],
                        code: 'custom',
                        message: 'choose someone who can receive money',
                    });
                    return;
                }
                // Prevent self-sends
                if (data.receiver.walletPK === currentWalletPK) {
                    ctx.addIssue({
                        path: ['receiver'],
                        code: 'custom',
                        message: 'cannot send money to yourself',
                    });
                    return;
                }
                const sats = toSats(data.amount, data.inputUnit, price);
                if (sats <= 0n || sats > max) {
                    ctx.addIssue({
                        path: ['amount'],
                        code: 'custom',
                        message: `amount 1-${max.toString()} sats`,
                    });
                } else {
                    data.amount = sats;
                }
            })
            .transform((d) => ({ ...d, amount: d.amount }));

    const resolver = useMemo(() => zodResolver(schema(balance, bitcoin.price, currentUserWalletPK)), [balance, bitcoin.price, currentUserWalletPK]);
    const form = useForm({
        resolver,
        defaultValues: {
            receiver: null,
            amount: '',
            inputUnit: unit,
        },
    });
    const watchedInputUnit = form.watch('inputUnit');

    useEffect(() => {
        const nextReceiver = peer || null;
        const defaultValues = {
            receiver: nextReceiver,
            amount: amount || '',
            inputUnit: unit,
        };
        const current = form.getValues();
        setReceiver(nextReceiver);
        if (current.receiver === defaultValues.receiver && current.amount === defaultValues.amount && current.inputUnit === defaultValues.inputUnit) {
            return;
        }
        form.reset(defaultValues);
    }, [peer, amount, unit, form]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            if (start === 'amount') {
                amountInputRef.current?.focus({ preventScroll: true });
            }
        }, 0);

        return () => window.clearTimeout(timeout);
    }, [start]);

    const setUnit = useCallback(
        (u) => {
            if (!u) return;
            const currentUnit = form.getValues('inputUnit');
            if (u === currentUnit) return;
            const currentAmount = form.getValues('amount');
            let nextAmount = currentAmount;
            if (currentAmount) {
                const sats = toSats(currentAmount, currentUnit, bitcoin.price);
                form.setValue('inputUnit', u);
                if (sats === 0n) {
                    nextAmount = '';
                    form.setValue('amount', nextAmount);
                } else {
                    nextAmount = toDisplay(sats, u, bitcoin.price);
                    form.setValue('amount', nextAmount);
                }
            } else {
                form.setValue('inputUnit', u);
            }
            onInputUnitChange?.(u);
            if (nextAmount !== currentAmount) {
                onAmountChange?.(nextAmount);
            }
            if (amountInputRef.current) {
                amountInputRef.current.focus();
            }
        },
        [form, bitcoin.price, onAmountChange, onInputUnitChange]
    );

    const cycleUnit = useCallback(() => {
        const currentUnit = form.getValues('inputUnit');
        const index = MONEY_UNITS.indexOf(currentUnit);
        setUnit(MONEY_UNITS[(index + 1) % MONEY_UNITS.length]);
    }, [form, setUnit]);

    const setAmount = useCallback(
        (raw) => {
            const unit = form.getValues('inputUnit');
            const max = balance;
            const accept = (regex, ok) => {
                if (!regex.test(raw) || !ok()) return;
                form.setValue('amount', raw);
                onAmountChange?.(raw);
            };
            if (unit === 'sats') {
                // Prevent entering only zeros or starting with zero in sats mode
                const isValidSats = raw === '' || (!/^0+$/.test(raw) && !/^0\d/.test(raw));
                accept(/^\d{0,16}$/, () => isValidSats && BigInt(raw || 0) <= max);
            } else if (unit === 'btc') {
                accept(/^\d{0,8}(\.\d{0,8})?$/, () => toSats(raw, 'btc', bitcoin.price) <= max);
            } else if (unit === 'usd') {
                // Only allow single 0 before decimal point in USD mode
                const isValidUsd = raw === '' || !/^0\d/.test(raw);
                accept(/^\d{0,8}(\.\d{0,4})?$/, () => isValidUsd && (raw === '' || toSats(raw, 'usd', bitcoin.price) <= max));
            }
        },
        [form, balance, bitcoin.price, onAmountChange]
    );

    const handleAmountChange = useCallback(
        (e) => {
            setAmount(e.target.value);
        },
        [setAmount]
    );

    useEffect(() => {
        form.clearErrors();
    }, [balance, form]);

    const onSubmit = useCallback(
        async (data) => {
            setIsSubmitting(true);
            const displayName = formatUserDisplay(data.receiver, false);
            const formattedAmount = renderMoney(data.amount.toString(), settings.moneyFormat, bitcoin.price);
            closeDialog();
            // show loading toast
            const loadingToastId = toast(cloaked ? `sending money to ${displayName}` : `sending ${formattedAmount} to ${displayName}`, {
                icon: <Loader className="animate-spin" />,
                duration: Infinity,
            });

            try {
                const amountStr = data.amount.toString();
                const txId = await sendMoneyWithSpark(data.receiver.walletPK, amountStr);
                toast.success(cloaked ? `sent money to ${displayName}` : `sent ${formattedAmount} to ${displayName}`, {
                    id: loadingToastId,
                    icon: <Coins />,
                    duration: 2000,
                });
                form.reset({
                    receiver: null,
                    amount: '',
                    inputUnit: settings.moneyFormat,
                });
                setReceiver(null);
                onPeerChange?.(null);
                onAmountChange?.('');
                onInputUnitChange?.(settings.moneyFormat);
            } catch (error) {
                toast.error(error.message || 'failed to send money', {
                    id: loadingToastId,
                    duration: 2000,
                });
            } finally {
                setIsSubmitting(false);
            }
        },
        [sendMoneyWithSpark, settings.moneyFormat, bitcoin.price, closeDialog, form, onAmountChange, onInputUnitChange, onPeerChange]
    );

    return (
        <div className="flex flex-col gap-2">
            <form id="sendMoney" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                <Field
                    control={form.control}
                    name="receiver"
                    render={({ field }) => (
                        <PeerSelector
                            className="h-12 pl-2 pr-3 text-base [&_.avatar]:size-9"
                            selectedPeer={receiver}
                            onPeerChange={(peer) => {
                                setReceiver(peer);
                                field.onChange(peer);
                                onPeerChange?.(peer);
                                if (amountInputRef.current) {
                                    amountInputRef.current.focus();
                                }
                            }}
                            disabled={isSubmitting}
                            active={start === 'peer'}
                            filterPeers={(peer) => Boolean(peer.walletPK)}
                            label="receiver"
                        />
                    )}
                />
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
                                autoFocus={peer && !hasAmount}
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
            </form>
            <div className="flex gap-2.5">
                <Button
                    type="submit"
                    form="sendMoney"
                    className="button-outline shrinker flex-1"
                    disabled={
                        isSubmitting ||
                        !form.watch('receiver') ||
                        !form.watch('amount') ||
                        form.watch('amount') === '0' ||
                        toSats(form.watch('amount'), form.watch('inputUnit'), bitcoin.price) === 0n ||
                        form.watch('receiver')?.walletPK === currentUserWalletPK
                    }
                >
                    {isSubmitting ? <Loader className="animate-spin" /> : 'send'}
                </Button>
                <Button
                    tabIndex={-1}
                    className="grower-lg"
                    type="button"
                    onClick={() => {
                        closeDialog();
                        router.push('/camera');
                    }}
                    disabled={isSubmitting}
                >
                    <ScanQrCode className="size-6" />
                </Button>
            </div>
        </div>
    );
}
