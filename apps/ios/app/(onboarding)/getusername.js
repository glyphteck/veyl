import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { useTheme } from '@/providers/themeprovider';
import { cloud } from '@/lib/cloud';
import GlassButton from '@/components/glass/glassbutton';
import GlassField from '@/components/glass/glassfield';
import Icon from '@/components/icon';
import { MAX_USERNAME, cleanUsername, isUsername, isUsernameTakenError, normalizeUsername } from '@veyl/shared/username';

export default function NewUserUsername() {
    const { theme } = useTheme();
    const resetRef = useRef(null);
    const [username, setUsername] = useState('');
    const [status, setStatus] = useState('idle');

    const { labelText, showInvalid, showUnavailable, showLoader, disabled } = useMemo(() => {
        if (status === 'submitting') {
            return {
                labelText: 'verifying username',
                showInvalid: false,
                showUnavailable: false,
                showLoader: true,
                disabled: true,
            };
        }
        if (status === 'unavailable' || status === 'taken') {
            return {
                labelText: status === 'taken' ? 'username taken' : 'username unavailable',
                showInvalid: false,
                showUnavailable: true,
                showLoader: false,
                disabled: false,
            };
        }
        if (!username) {
            return {
                labelText: 'choose a username',
                showInvalid: false,
                showUnavailable: false,
                showLoader: false,
                disabled: false,
            };
        }
        if (!isUsername(username)) {
            return {
                labelText: 'choose a different username',
                showInvalid: true,
                showUnavailable: false,
                showLoader: false,
                disabled: false,
            };
        }
        return {
            labelText: 'choose a username',
            showInvalid: false,
            showUnavailable: false,
            showLoader: false,
            disabled: false,
        };
    }, [status, username]);

    useEffect(() => {
        return () => clearTimeout(resetRef.current);
    }, []);

    const changeUsername = (value) => {
        clearTimeout(resetRef.current);
        setStatus('idle');
        setUsername(cleanUsername(value));
    };

    const handleSubmit = async () => {
        const trimmed = normalizeUsername(username);
        if (!isUsername(trimmed)) return;
        clearTimeout(resetRef.current);
        setStatus('submitting');
        try {
            await cloud.user.username.get(trimmed);
        } catch (err) {
            console.warn('set username failed', err);
            setUsername('');
            setStatus(isUsernameTakenError(err) ? 'taken' : 'unavailable');
            clearTimeout(resetRef.current);
            resetRef.current = setTimeout(() => setStatus('idle'), 1500);
        }
    };

    const buttonDisabled = !isUsername(username) || disabled;

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <View style={{ width: '100%', maxWidth: 360, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: theme.foreground }}>{labelText}</Text>
                    {showInvalid || showUnavailable ? <Icon icon={TriangleAlert} size={18} color={theme.destructive} /> : null}
                    {showLoader ? <ActivityIndicator size="small" color={theme.foreground} /> : null}
                </View>
                <GlassField disabled={disabled} style={{ gap: 8, paddingHorizontal: 14, marginBottom: 1 }}>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: theme.muted, paddingVertical: 10 }}>@</Text>
                    <TextInput
                        value={username}
                        onChangeText={changeUsername}
                        placeholder="username"
                        placeholderTextColor={theme.muted}
                        autoCorrect={false}
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={MAX_USERNAME}
                        editable={!disabled}
                        style={{ flex: 1, fontSize: 20, color: theme.foreground, paddingVertical: 10 }}
                    />
                </GlassField>
                <GlassButton onPress={handleSubmit} label="confirm" accent disabled={buttonDisabled} style={{ width: '100%', marginTop: 8 }} pressableStyle={{ alignSelf: 'stretch' }} />
            </View>
        </View>
    );
}
