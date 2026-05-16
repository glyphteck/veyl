import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUpRight, CircleDollarSign, CircleUserRound, EyeOff, Focus, Lock, LockOpen, ScanQrCode, Settings2, ShieldCheck, Timer, UserRoundCog } from 'lucide-react';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Field } from '@/components/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/togglegroup';
import { useUser } from '@/components/providers/userprovider';
import UpdateAvatar from '@/components/updateavatar';
import { deleteAvatar, uploadAvatar } from '@/lib/useractions';

const settingsSchema = z.object({
    moneyFormat: z.enum(['btc', 'usd', 'sats']),
    sendOnScan: z.boolean(),
    confirmSend: z.boolean(),
    autolock: z.object({
        timer: z.union([z.coerce.number().int().min(1).max(60), z.literal('never')]),
        onHide: z.boolean(),
        onBlur: z.boolean(),
    }),
});

const MONEY_FORMATS = ['btc', 'sats', 'usd'];
const MONEY_LABELS = {
    btc: '₿',
    sats: 'sats',
    usd: 'US$',
};

export default function Settings({ data, close }) {
    const [selectedAvatar, setSelectedAvatar] = useState(null);
    const [avatarHidden, setAvatarHidden] = useState(false);
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [tooltip, setTooltip] = useState('save');
    const { settings, uid, avatar, avatarBanned, refetchAvatar, clearAvatar, updateSettings } = useUser();
    const hasChangesRef = useRef(false);
    const isManualSaveRef = useRef(false);

    const form = useForm({
        resolver: zodResolver(settingsSchema),
        defaultValues: {
            moneyFormat: settings.moneyFormat,
            sendOnScan: settings.sendOnScan,
            confirmSend: settings.confirmSend,
            autolock: {
                timer: settings.autolock.timer,
                onHide: settings.autolock.onHide,
                onBlur: settings.autolock.onBlur,
            },
        },
    });

    useEffect(() => {
        form.reset({
            moneyFormat: settings.moneyFormat,
            sendOnScan: settings.sendOnScan,
            confirmSend: settings.confirmSend,
            autolock: {
                timer: settings.autolock.timer,
                onHide: settings.autolock.onHide,
                onBlur: settings.autolock.onBlur,
            },
        });
        hasChangesRef.current = false;
        isManualSaveRef.current = false;
    }, [form, settings]);

    useEffect(() => {
        const subscription = form.watch(() => {
            hasChangesRef.current = true;
        });
        return () => subscription.unsubscribe();
    }, [form]);

    const handleAvatarSelect = (imageData) => {
        setAvatarHidden(false);
        setSelectedAvatar(imageData);
    };

    const handleAvatarUpload = async (imageData) => {
        if (avatarBanned || avatarBusy) return;
        setAvatarBusy(true);
        try {
            const success = await uploadAvatar(imageData);
            if (success) {
                await refetchAvatar({ optimistic: true });
            } else {
                setSelectedAvatar(null);
            }
        } finally {
            setAvatarBusy(false);
        }
    };

    const handleAvatarDelete = async () => {
        if (avatarBusy) return;
        setAvatarHidden(true);
        setSelectedAvatar(null);
        setAvatarBusy(true);
        try {
            const success = await deleteAvatar();
            if (success) {
                clearAvatar?.();
            } else {
                setAvatarHidden(false);
            }
        } finally {
            setAvatarBusy(false);
        }
    };

    const saveSettings = useCallback(async () => {
        if (!uid) return;
        const values = form.getValues();
        await updateSettings({
            moneyFormat: values.moneyFormat,
            sendOnScan: values.sendOnScan,
            confirmSend: values.confirmSend,
            autolock: {
                timer: values.autolock.timer,
                onHide: values.autolock.onHide,
                onBlur: values.autolock.onBlur,
            },
        }).catch((error) => {
            console.error('Error updating settings:', error);
        });
    }, [form, uid, updateSettings]);

    useEffect(() => {
        return () => {
            if (hasChangesRef.current && !isManualSaveRef.current && uid) {
                void saveSettings();
            }
        };
    }, [saveSettings, uid]);

    return (
        <div className="flex w-xl flex-col gap-2">
            <Tabs defaultValue="preferences">
                <TabsList>
                    <TabsTrigger value="preferences">
                        <Settings2 />
                        preferences
                    </TabsTrigger>
                    {!avatarBanned ? (
                        <TabsTrigger value="profile">
                            <UserRoundCog />
                            profile
                        </TabsTrigger>
                    ) : null}
                </TabsList>

                {!avatarBanned ? (
                    <TabsContent value="profile">
                        <div className="flex flex-col gap-2">
                            <Card>
                                <div className="p-4 flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <div className="pl-[5px] flex items-center gap-2 text-lg font-black leading-none select-none">
                                            <CircleUserRound />
                                            <span className="hidden sm:inline">avatar</span>
                                        </div>
                                        <UpdateAvatar
                                            className="size-12"
                                            currentAvatar={avatarHidden ? null : avatar}
                                            disabled={avatarBusy}
                                            onImageSelect={handleAvatarSelect}
                                            onImageUpload={handleAvatarUpload}
                                            onRemove={handleAvatarDelete}
                                            removeDisabled={avatarBusy}
                                            selectedImage={selectedAvatar}
                                            showRemove={!!(selectedAvatar || (!avatarHidden && avatar)) && !avatarBusy}
                                        />
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </TabsContent>
                ) : null}

                <TabsContent value="preferences">
                    <Card>
                        <div className="p-4 flex flex-col">
                            <Field
                                control={form.control}
                                name="moneyFormat"
                                render={({ field, labelProps, controlProps }) => (
                                    <div className="flex items-center justify-between gap-4 py-1">
                                        <label {...labelProps} className="pl-[5px] flex items-center gap-2 text-lg font-black leading-none select-none">
                                            <CircleDollarSign />
                                            <span className="hidden sm:inline">display currency</span>
                                        </label>
                                        <ToggleGroup {...controlProps} type="single" value={field.value} onValueChange={(v) => v && field.onChange(v)} required>
                                            {MONEY_FORMATS.map((format) => (
                                                <ToggleGroupItem
                                                    key={format}
                                                    value={format}
                                                    onMouseEnter={() => setTooltip(`show amounts in ${format}`)}
                                                    onMouseLeave={() => setTooltip('save')}
                                                >
                                                    {MONEY_LABELS[format]}
                                                </ToggleGroupItem>
                                            ))}
                                        </ToggleGroup>
                                    </div>
                                )}
                            />

                            <div className="flex items-center justify-between gap-4 py-4">
                                <div className="pl-0.75 flex items-center gap-2 text-lg leading-none select-none">
                                    <ArrowUpRight className="size-6" />
                                    <span>payment behaviour</span>
                                </div>
                                <ToggleGroup
                                    type="multiple"
                                    value={(() => {
                                        const values = [];
                                        if (form.watch('sendOnScan')) values.push('sendOnScan');
                                        if (form.watch('confirmSend')) values.push('confirmSend');
                                        return values;
                                    })()}
                                    onValueChange={(vals) => {
                                        form.setValue('sendOnScan', vals.includes('sendOnScan'));
                                        form.setValue('confirmSend', vals.includes('confirmSend'));
                                    }}
                                >
                                    <ToggleGroupItem
                                        value="sendOnScan"
                                        className="data-[state=on]:bg-destructive data-[state=on]:text-background"
                                        onMouseEnter={() => setTooltip('send immediately when the qr already includes an amount')}
                                        onMouseLeave={() => setTooltip('save')}
                                    >
                                        <ScanQrCode />
                                    </ToggleGroupItem>
                                    <ToggleGroupItem value="confirmSend" onMouseEnter={() => setTooltip('confirm before sending money')} onMouseLeave={() => setTooltip('save')}>
                                        <ShieldCheck />
                                    </ToggleGroupItem>
                                </ToggleGroup>
                            </div>

                            <div className="bg-border h-px w-full shrink-0 rounded-full" aria-hidden />

                            <Field
                                control={form.control}
                                name="autolock.timer"
                                render={({ field, labelProps, controlProps }) => (
                                    <div className="flex items-center justify-between gap-4 py-4">
                                        <label {...labelProps} className="pl-[5px] flex items-center gap-2 text-lg font-black leading-none select-none">
                                            <Timer />
                                            <span className="hidden sm:inline">lock timeout</span>
                                        </label>
                                        <ToggleGroup
                                            {...controlProps}
                                            type="single"
                                            value={String(field.value)}
                                            onValueChange={(v) => {
                                                if (v) field.onChange(v === 'never' ? 'never' : Number(v));
                                            }}
                                            required
                                        >
                                            {[1, 5, 10, 15, 30, 60].map((n) => (
                                                <ToggleGroupItem
                                                    key={n}
                                                    value={String(n)}
                                                    onMouseEnter={() => setTooltip(`auto-lock after ${n} minute${n === 1 ? '' : 's'}`)}
                                                    onMouseLeave={() => setTooltip('save')}
                                                >
                                                    {n}
                                                </ToggleGroupItem>
                                            ))}
                                            <ToggleGroupItem value="never" onMouseEnter={() => setTooltip('never auto-lock')} onMouseLeave={() => setTooltip('save')}>
                                                <LockOpen />
                                            </ToggleGroupItem>
                                        </ToggleGroup>
                                    </div>
                                )}
                            />

                            <div className="flex items-center justify-between gap-4 py-1">
                                <div className="pl-[5px] flex items-center gap-2 text-lg font-black leading-none select-none">
                                    <Lock />
                                    <span className="hidden sm:inline">lock behavior</span>
                                </div>
                                <ToggleGroup
                                    type="multiple"
                                    value={(() => {
                                        const auto = form.watch('autolock');
                                        return [auto.onHide && 'hide', auto.onBlur && 'blur'].filter(Boolean);
                                    })()}
                                    onValueChange={(vals) => {
                                        form.setValue('autolock.onHide', vals.includes('hide'));
                                        form.setValue('autolock.onBlur', vals.includes('blur'));
                                    }}
                                >
                                    <ToggleGroupItem value="hide" onMouseEnter={() => setTooltip('lock when the app is hidden')} onMouseLeave={() => setTooltip('save')}>
                                        <EyeOff />
                                    </ToggleGroupItem>
                                    <ToggleGroupItem value="blur" onMouseEnter={() => setTooltip('lock when the app loses focus')} onMouseLeave={() => setTooltip('save')}>
                                        <Focus />
                                    </ToggleGroupItem>
                                </ToggleGroup>
                            </div>
                        </div>
                    </Card>
                </TabsContent>
            </Tabs>

            <Button
                onClick={async () => {
                    isManualSaveRef.current = true;
                    await saveSettings();
                    close();
                }}
                className="button-outline shrinker"
                disabled={tooltip !== 'save'}
            >
                {tooltip}
            </Button>
        </div>
    );
}
