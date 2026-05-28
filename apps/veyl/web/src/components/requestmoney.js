import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@/components/field';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { Loader, CircleCheck, QrCode } from 'lucide-react';
import { formatUserDisplay, toSats, toDisplay, renderMoney, satsInABitcoin } from '@/lib/utils';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useUser } from '@/components/providers/userprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useChat } from '@/components/providers/chatprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { makeReq } from '@glyphteck/shared/chat/messages';
import { makeRequestQr, qr } from '@glyphteck/shared/qrutils';
import { toast } from 'sonner';
import PeerSelector from '@/components/peerselector';

const MONEY_UNITS = ['sats', 'btc', 'usd'];

function unitLabel(unit) {
    if (unit === 'btc') return '₿';
    if (unit === 'usd') return '$';
    return 'sats';
}

export default function RequestMoney({ peer, amount = '', inputUnit, onPeerChange, onAmountChange, onInputUnitChange }) {
    const [sender, setSender] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const bitcoin = useBitcoin();
    const { settings, walletPK: currentUserWalletPK } = useUser();
    const { closeDialog, openDialog } = useDialog();
    const { sendMessage } = useChat();
    const { cloaked } = useCloak();
    const amountInputRef = useRef(null);
    const MAX_AMOUNT = satsInABitcoin * 100000n; // 100k bitcoin in sats
    const unit = inputUnit || settings.moneyFormat;
    const hasAmount = amount != null && amount !== '';
    const start = !peer ? 'peer' : !hasAmount ? 'amount' : null;

    const schema = (max, price, currentWalletPK) =>
        z
            .object({
                sender: z.object({}).passthrough(),
                inputUnit: z.enum(['sats', 'btc', 'usd']),
                amount: z.string().regex(/^\d+(\.\d{0,8})?$/, 'invalid number'),
            })
            .superRefine((data, ctx) => {
                if (!data.sender?.walletPK) {
                    ctx.addIssue({
                        path: ['sender'],
                        code: 'custom',
                        message: 'choose someone who can receive money',
                    });
                    return;
                }
                if (!data.sender?.chatPK) {
                    ctx.addIssue({
                        path: ['sender'],
                        code: 'custom',
                        message: 'choose someone who can receive requests',
                    });
                    return;
                }

                // Prevent self-requests
                if (data.sender.walletPK === currentWalletPK) {
                    ctx.addIssue({
                        path: ['sender'],
                        code: 'custom',
                        message: 'cannot request money from yourself',
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

    const resolver = useMemo(() => zodResolver(schema(MAX_AMOUNT, bitcoin.price, currentUserWalletPK)), [bitcoin.price, currentUserWalletPK]);
    const form = useForm({
        resolver,
        defaultValues: {
            sender: null,
            amount: '',
            inputUnit: unit,
        },
    });
    const watchedInputUnit = form.watch('inputUnit');

    useEffect(() => {
        const nextSender = peer || null;
        const defaultValues = {
            sender: nextSender,
            amount: amount || '',
            inputUnit: unit,
        };
        const current = form.getValues();
        setSender(nextSender);
        if (current.sender === defaultValues.sender && current.amount === defaultValues.amount && current.inputUnit === defaultValues.inputUnit) {
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
            const max = MAX_AMOUNT;
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
        [form, bitcoin.price, onAmountChange]
    );

    const handleAmountChange = useCallback(
        (e) => {
            setAmount(e.target.value);
        },
        [setAmount]
    );

    useEffect(() => {
        form.clearErrors();
    }, [form]);

    const onSubmit = useCallback(
        async (data) => {
            setIsSubmitting(true);
            const displayName = formatUserDisplay(data.sender, false);
            const formattedAmount = renderMoney(data.amount.toString(), settings.moneyFormat, bitcoin.price);
            closeDialog();
            try {
                const message = makeReq(data.amount.toString());
                await sendMessage(data.sender.chatPK, message);
                toast(`requested ${formattedAmount} from ${displayName}`, { icon: <CircleCheck /> });
                form.reset({
                    sender: null,
                    amount: '',
                    inputUnit: settings.moneyFormat,
                });
                setSender(null);
                onPeerChange?.(null);
                onAmountChange?.('');
                onInputUnitChange?.(settings.moneyFormat);
            } catch {
                toast.error('failed to send request');
            } finally {
                setIsSubmitting(false);
            }
        },
        [sendMessage, closeDialog, settings.moneyFormat, bitcoin.price, form, onAmountChange, onInputUnitChange, onPeerChange]
    );

    const requestWithQR = () => {
        const senderPeer = form.watch('sender');
        const amount = form.watch('amount');
        const sats = amount && amount !== '0' ? toSats(amount, form.watch('inputUnit'), bitcoin.price) : 0n;
        const qrData = makeRequestQr({
            to: currentUserWalletPK,
            ...(senderPeer?.walletPK ? { from: senderPeer.walletPK } : {}),
            ...(sats > 0n ? { amount: sats.toString() } : {}),
        });
        if (!qrData) return;
        openDialog('qrcode', { type: qr.request, value: qrData });
    };

    return (
        <div className="flex flex-col gap-2">
            <form id="request-money-form" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                <Field
                    control={form.control}
                    name="sender"
                    render={({ field }) => (
                        <PeerSelector
                            className="h-12 pl-2 pr-3 text-base [&_.avatar]:size-9"
                            selectedPeer={sender}
                            onPeerChange={(peer) => {
                                setSender(peer);
                                field.onChange(peer);
                                onPeerChange?.(peer);
                                if (amountInputRef.current) {
                                    amountInputRef.current.focus();
                                }
                            }}
                            disabled={isSubmitting}
                            active={start === 'peer'}
                            filterPeers={(peer) => Boolean(peer.walletPK && peer.chatPK)}
                            label="sender"
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
                    form="request-money-form"
                    className="button-outline shrinker flex-1"
                    disabled={
                        isSubmitting ||
                        !form.watch('sender') ||
                        !form.watch('amount') ||
                        form.watch('amount') === '0' ||
                        toSats(form.watch('amount'), form.watch('inputUnit'), bitcoin.price) === 0n ||
                        form.watch('sender')?.walletPK === currentUserWalletPK
                    }
                >
                    {isSubmitting ? <Loader className="animate-spin" /> : 'request'}
                </Button>
                <Button
                    tabIndex={-1}
                    className="grower-lg"
                    type="button"
                    onClick={requestWithQR}
                    disabled={
                        isSubmitting ||
                        form.watch('sender')?.walletPK === currentUserWalletPK ||
                        !(form.watch('sender')?.walletPK || (form.watch('amount') && form.watch('amount') !== '0' && toSats(form.watch('amount'), form.watch('inputUnit'), bitcoin.price) > 0n))
                    }
                >
                    <QrCode className="size-6" />
                </Button>
            </div>
        </div>
    );
}
