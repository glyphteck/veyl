import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@/components/field';
import { Input } from '@/components/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/togglegroup';
import { Button } from '@/components/button';
import { Loader, CircleCheck, QrCode } from 'lucide-react';
import { formatUserDisplay, toSats, toDisplay, renderMoney, satsInABitcoin } from '@/lib/utils';
import { Card } from '@/components/card';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useUser } from '@/components/providers/userprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useChat } from '@/components/providers/chatprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { makeReq } from '@glyphteck/shared/chat/messages';
import { makeRequestQr, qr } from '@glyphteck/shared/qrutils';
import { toast } from 'sonner';
import PeerSelector from '@/components/peerselector';

export default function RequestMoney({ peer, amount }) {
    const [sender, setSender] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const bitcoin = useBitcoin();
    const { settings, walletPK: currentUserWalletPK } = useUser();
    const { closeDialog, openDialog } = useDialog();
    const { sendMessage } = useChat();
    const { cloaked } = useCloak();
    const amountInputRef = useRef(null);
    const requestButtonRef = useRef(null);
    const MAX_AMOUNT = satsInABitcoin * 100000n; // 100k bitcoin in sats
    const hasAmount = amount != null && amount !== '';
    const start = !peer ? 'peer' : !hasAmount ? 'amount' : 'submit';

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
                        message: 'sender must have walletPK',
                    });
                    return;
                }
                if (!data.sender?.chatPK) {
                    ctx.addIssue({
                        path: ['sender'],
                        code: 'custom',
                        message: 'sender must have chatPK',
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
            inputUnit: settings.moneyFormat,
        },
    });

    useEffect(() => {
        const defaultValues = {
            sender: peer || null,
            amount: hasAmount ? toDisplay(amount, settings.moneyFormat, bitcoin.price) : '',
            inputUnit: settings.moneyFormat,
        };
        form.reset(defaultValues);
        setSender(peer || null);
    }, [peer, hasAmount, amount, settings.moneyFormat, bitcoin.price, form]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            if (start === 'amount') {
                amountInputRef.current?.focus({ preventScroll: true });
                return;
            }
            if (start === 'submit') {
                requestButtonRef.current?.focus({ preventScroll: true });
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
            const max = MAX_AMOUNT;
            const accept = (regex, ok) => {
                if (regex.test(raw) && ok()) form.setValue('amount', raw);
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
        [form, bitcoin.price]
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
            } catch (error) {
                console.error('Failed to send request money message:', error);
                toast.error('failed to send request');
            } finally {
                setIsSubmitting(false);
            }
        },
        [sendMessage, closeDialog, settings.moneyFormat, bitcoin.price, form]
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
            <Card>
                <div className="px-4 py-6">
                    <form id="request-money-form" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                        <Field
                            control={form.control}
                            name="sender"
                            render={({ field }) => (
                                <PeerSelector
                                    selectedPeer={sender}
                                    onPeerChange={(peer) => {
                                        setSender(peer);
                                        field.onChange(peer);
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
                                <div className="flex items-center gap-2.5">
                                    <Input
                                        {...field}
                                        {...inputProps}
                                        ref={(el) => {
                                            field.ref(el);
                                            amountInputRef.current = el;
                                        }}
                                        className={`w-54 ${cloaked ? 'cloaked' : ''}`}
                                        placeholder={form.watch('inputUnit') === 'sats' ? '0000' : '0.00'}
                                        onChange={handleAmountChange}
                                        inputMode="numeric"
                                        pattern={form.watch('inputUnit') === 'sats' ? '[0-9]*' : '[0-9.]*'}
                                        disabled={isSubmitting}
                                        autoFocus={peer && !hasAmount}
                                    />
                                    <ToggleGroup tabIndex={-1} className="ml-auto" type="single" value={form.watch('inputUnit')} onValueChange={setUnit} disabled={isSubmitting}>
                                        <ToggleGroupItem value="btc" className="font-helvetica">
                                            ₿
                                        </ToggleGroupItem>
                                        <ToggleGroupItem value="sats">sats</ToggleGroupItem>
                                        <ToggleGroupItem value="usd">$</ToggleGroupItem>
                                    </ToggleGroup>
                                </div>
                            )}
                        />
                    </form>
                </div>
            </Card>
            <div className="flex gap-2.5">
                <Button
                    ref={requestButtonRef}
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
