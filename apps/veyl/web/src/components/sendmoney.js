import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@/components/field';
import { Input } from '@/components/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/togglegroup';
import { Button } from '@/components/button';
import { Loader, Coins, PiggyBank, ScanQrCode } from 'lucide-react';
import { formatUserDisplay, toSats, toDisplay, renderMoney } from '@/lib/utils';
import { Card } from '@/components/card';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { toast } from 'sonner';
import PeerSelector from '@/components/peerselector';

export default function SendMoney({ peer, amount }) {
    const [receiver, setReceiver] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const bitcoin = useBitcoin();
    const { sendMoneyWithSpark, balance } = useWallet();
    const { settings, walletPK: currentUserWalletPK } = useUser();
    const { closeDialog, openDialog } = useDialog();
    const router = useRouter();
    const { cloaked } = useCloak();
    const amountInputRef = useRef(null);
    const sendButtonRef = useRef(null);
    const hasAmount = amount != null && amount !== '';
    const start = !peer ? 'peer' : !hasAmount ? 'amount' : 'submit';

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
                        message: 'receiver must have walletPK',
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
            inputUnit: settings.moneyFormat,
        },
    });

    useEffect(() => {
        const defaultValues = {
            receiver: peer || null,
            amount: hasAmount ? toDisplay(amount, settings.moneyFormat, bitcoin.price) : '',
            inputUnit: settings.moneyFormat,
        };
        form.reset(defaultValues);
        setReceiver(peer || null);
    }, [peer, hasAmount, amount, settings.moneyFormat, bitcoin.price, form]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            if (start === 'amount') {
                amountInputRef.current?.focus({ preventScroll: true });
                return;
            }
            if (start === 'submit') {
                sendButtonRef.current?.focus({ preventScroll: true });
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
            const max = balance;
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
        form.setValue('amount', toDisplay(balance, unit, bitcoin.price));
    }, [form, balance, bitcoin.price]);

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
            } catch (error) {
                toast.error(error.message || 'failed to send money', {
                    id: loadingToastId,
                    duration: 2000,
                });
            } finally {
                setIsSubmitting(false);
            }
        },
        [sendMoneyWithSpark, settings.moneyFormat, bitcoin.price, closeDialog, form]
    );

    return (
        <div className="flex flex-col gap-2">
            <Card>
                <div className="px-4 py-6">
                    <form id="sendMoney" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                        <Field
                            control={form.control}
                            name="receiver"
                            render={({ field }) => (
                                <PeerSelector
                                    className="w-full"
                                    selectedPeer={receiver}
                                    onPeerChange={(peer) => {
                                        setReceiver(peer);
                                        field.onChange(peer);
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
                                <div className="flex gap-2.5">
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
                                    <Button tabIndex={-1} className="grower-lg hidden sm:block" type="button" onClick={setMax} disabled={isSubmitting}>
                                        <PiggyBank className="size-6 stroke-2" />
                                    </Button>
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
                    ref={sendButtonRef}
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
