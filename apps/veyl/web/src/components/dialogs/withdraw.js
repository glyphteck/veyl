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
import { Rabbit, Turtle, Snail, Loader, PiggyBank, CircleCheck, ScanQrCode } from 'lucide-react';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { useCloak } from '@glyphteck/shared/providers/cloakprovider';
import { toSats, toDisplay, truncateAddress, renderMoney } from '@/lib/utils';
import { minWithdrawalSats } from '@glyphteck/shared/spark';
import { isAddressOnNetwork, isMainnet } from '@glyphteck/shared/network';
import { toast } from 'sonner';

export default function Withdraw({ data, close }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
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
                const sats = toSats(data.amount, data.inputUnit, price);
                if (sats <= 0n || sats < minWithdrawalSats) {
                    ctx.addIssue({
                        path: ['amount'],
                        code: 'custom',
                        message: `minimum withdrawal ${minWithdrawalSats.toString()} sats`,
                    });
                } else if (sats > max) {
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
        form.setValue('amount', toDisplay(balance, unit, bitcoin.price));
    }, [form, balance, bitcoin.price]);

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
        [withdrawFunds, close, form, settings.moneyFormat, bitcoin.price]
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
                                        placeholder={form.watch('inputUnit') === 'sats' ? '0000' : '0.00'}
                                        onChange={handleAmountChange}
                                        inputMode="numeric"
                                        pattern={form.watch('inputUnit') === 'sats' ? '[0-9]*' : '[0-9.]*'}
                                        disabled={isSubmitting}
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
            <Button
                type="submit"
                form="withdraw-funds-form"
                className="button-outline shrinker"
                disabled={
                    isSubmitting ||
                    !form.watch('receivingAddress') ||
                    !isAddressOnNetwork(form.watch('receivingAddress'), network) ||
                    !form.watch('amount') ||
                    form.watch('amount') === '0' ||
                    toSats(form.watch('amount'), form.watch('inputUnit'), bitcoin.price) === 0n ||
                    toSats(form.watch('amount'), form.watch('inputUnit'), bitcoin.price) < minWithdrawalSats
                }
            >
                {isSubmitting ? <Loader className="animate-spin" /> : 'withdraw'}
            </Button>
        </div>
    );
}
