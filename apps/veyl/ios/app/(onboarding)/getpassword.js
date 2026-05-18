import { useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CircleQuestionMark, Eye, EyeOff, KeyRound } from 'lucide-react-native';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useTheme } from '@/providers/themeprovider';
import { auth, db } from '@/lib/firebase';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import Icon from '@/components/icon';
import { packSeedData } from '@glyphteck/shared/crypto/pack';
import { encryptSeed } from '@/lib/crypto/seed';
import { getPasswordFeedback, isPassword, MAX_PASSWORD, normalizePassword } from '@glyphteck/shared/password';
import { useTap } from '@/lib/tap';

export default function NewUserPassword() {
    const router = useRouter();
    const { theme } = useTheme();
    const buttonColor = theme.background;
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState('');
    const [submitError, setSubmitError] = useState('');

    const { labelText, status } = useMemo(() => {
        const feedback = getPasswordFeedback(password);
        if (feedback.status === 'idle') return { labelText: 'create a strong password', status: 'idle' };
        if (feedback.status === 'short') return { labelText: 'create a longer password', status: 'idle' };
        if (feedback.status === 'invalid') return { labelText: 'create a different password', status: 'invalid' };
        return { labelText: 'create a strong password', status: 'valid' };
    }, [password]);

    const canContinue = status === 'valid' && isPassword(password) && !isSubmitting;
    const rulesFeedback = useTap({ disabled: isSubmitting, onPress: () => router.push('/passwordrules') });
    const eyeFeedback = useTap({ disabled: isSubmitting, onPress: () => setShowPassword((prev) => !prev) });

    const yieldToUi = async () => {
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => setTimeout(r, 0));
    };

    const handleSubmit = async () => {
        if (!canContinue) return;

        setSubmitError('');
        setSubmitStatus('');

        const nextPassword = normalizePassword(password);
        if (!isPassword(nextPassword)) {
            setSubmitError('password is invalid');
            return;
        }

        const uid = auth.currentUser?.uid;
        if (!uid) {
            setSubmitError('not signed in — please go back and login again');
            return;
        }

        setIsSubmitting(true);
        try {
            setSubmitStatus('checking your wallet…');
            await yieldToUi();
            const seedDoc = await getDoc(doc(db, 'seeds', uid));
            if (!seedDoc.exists()) {
                setSubmitStatus('securing your wallet…');
                await yieldToUi();
                const seedData = await encryptSeed(nextPassword);
                setSubmitStatus('saving…');
                await yieldToUi();
                await setDoc(doc(db, 'seeds', uid), { es: packSeedData(seedData) });
            }
        } catch (err) {
            console.warn('password setup failed', err);
            setSubmitError(err?.message || 'something went wrong — try again');
        } finally {
            setIsSubmitting(false);
            setSubmitStatus('');
        }
    };

    return (
        <View style={{ flex: 1, padding: 24 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 140 }}>
                <View style={{ width: '100%', maxWidth: 360, gap: 10 }}>
                    <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }}>
                        <Text style={{ flex: 1, fontSize: 20, fontWeight: '600', color: theme.foreground }}>{labelText}</Text>
                        {isSubmitting ? (
                            <ActivityIndicator color={theme.foreground} size="small" />
                        ) : (
                            <Pressable {...rulesFeedback.props} disabled={isSubmitting} hitSlop={8}>
                                <Animated.View style={{ transform: [{ scale: rulesFeedback.scale }] }}>
                                    <Icon icon={CircleQuestionMark} size={24} color={theme.foreground} />
                                </Animated.View>
                            </Pressable>
                        )}
                    </View>
                    <GlassField disabled={isSubmitting} style={{ gap: 8, paddingHorizontal: 14 }}>
                        <Icon icon={KeyRound} size={22} color={status === 'idle' ? theme.muted : status === 'invalid' ? theme.destructive : theme.inflow} />
                        <TextInput
                            value={password}
                            onChangeText={(value) => setPassword(value.slice(0, MAX_PASSWORD))}
                            placeholder="password"
                            placeholderTextColor={theme.muted}
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                            secureTextEntry={!showPassword}
                            editable={!isSubmitting}
                            style={{ flex: 1, fontSize: 20, color: theme.foreground, paddingVertical: 10 }}
                        />
                        <Pressable {...eyeFeedback.props} disabled={isSubmitting} hitSlop={8}>
                            <Animated.View style={{ transform: [{ scale: eyeFeedback.scale }] }}>
                                {showPassword ? <Icon icon={Eye} size={22} color={theme.muted} /> : <Icon icon={EyeOff} size={22} color={theme.muted} />}
                            </Animated.View>
                        </Pressable>
                    </GlassField>
                    <Text style={{ color: theme.muted, fontSize: 13 }}>This password unlocks your encrypted wallet. Without it, your funds are lost forever.</Text>

                    {submitError ? <Text style={{ color: theme.destructive, fontSize: 13 }}>{submitError}</Text> : null}

                    <GlassButton onPress={handleSubmit} accent disabled={!canContinue} style={{ width: '100%', marginTop: 8 }} pressableStyle={{ alignSelf: 'stretch' }}>
                        {isSubmitting ? (
                            <>
                                <ActivityIndicator color={buttonColor} />
                                <Text style={{ color: buttonColor, fontSize: 17, fontWeight: '800' }}>{submitStatus || 'working…'}</Text>
                            </>
                        ) : (
                            <Text style={{ color: buttonColor, fontSize: 17, fontWeight: '800' }}>confirm</Text>
                        )}
                    </GlassButton>
                </View>
            </View>
        </View>
    );
}
