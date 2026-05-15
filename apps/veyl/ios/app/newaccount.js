import { useRef, useState } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/providers/themeprovider';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import { passkeyRegister } from '@/lib/passkeys';
import { useTap } from '@/lib/tap';
import GlassHeader from '@/components/glass/glassheader';
import { ChevronLeft } from 'lucide-react-native';
import Icon from '@/components/icon';

export default function NewAccount() {
    const { theme } = useTheme();
    const router = useRouter();
    const inputRef = useRef(null);
    const [accountName, setAccountName] = useState('');
    const [authState, setAuthState] = useState('idle');
    const isLoading = authState !== 'idle';
    const backTap = useTap({
        onPress: () => router.back(),
    });

    async function register(label) {
        if (isLoading) return;
        setAuthState('preparing');
        try {
            await passkeyRegister({
                label,
                onPrompt: () => setAuthState('prompt'),
            });
            router.replace('/getusername');
        } catch (err) {
            console.warn('passkey register failed', err);
            setAuthState('idle');
        }
    }

    const skipFeedback = useTap({
        disabled: isLoading,
        onPress: () => register(undefined),
    });

    return (
        <View style={{ flex: 1 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <View style={{ width: '100%', maxWidth: 360, gap: 12 }}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: theme.foreground, paddingLeft: 4 }}>what will you call this account?</Text>
                    <GlassField disabled={isLoading} style={{ paddingHorizontal: 14 }}>
                        <TextInput
                            ref={inputRef}
                            value={accountName}
                            onChangeText={setAccountName}
                            placeholder="account name"
                            placeholderTextColor={theme.muted}
                            autoCorrect={false}
                            autoCapitalize="none"
                            spellCheck={false}
                            editable={!isLoading}
                            autoFocus
                            returnKeyType="go"
                            onSubmitEditing={() => {
                                if (accountName.trim()) register(accountName.trim());
                            }}
                            style={{ flex: 1, fontSize: 20, color: theme.foreground, paddingVertical: 10 }}
                        />
                    </GlassField>
                    <GlassButton
                        onPress={() => register(accountName.trim())}
                        label={isLoading ? 'preparing passkey…' : 'create account'}
                        accent
                        disabled={isLoading || !accountName.trim()}
                        style={{ width: '100%', marginTop: 8 }}
                        pressableStyle={{ alignSelf: 'stretch' }}
                    />
                    <Pressable {...skipFeedback.props} disabled={isLoading} style={{ alignItems: 'center', marginTop: 4 }}>
                        <Animated.View style={{ opacity: isLoading ? 0.4 : 1, transform: [{ scale: skipFeedback.scale }] }}>
                            <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '600' }}>{"i don't care"}</Text>
                        </Animated.View>
                    </Pressable>
                </View>
            </View>
            <GlassHeader contentStyle={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 56, alignItems: 'flex-start', justifyContent: 'center' }}>
                    <Pressable {...backTap.props} hitSlop={10} style={{ justifyContent: 'center' }}>
                        <Animated.View style={{ transform: [{ scale: backTap.scale }] }}>
                            <Icon icon={ChevronLeft} color={theme.foreground} size={32} />
                        </Animated.View>
                    </Pressable>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: theme.foreground }}>new account</Text>
                </View>
                <View style={{ width: 56 }} />
            </GlassHeader>
        </View>
    );
}
