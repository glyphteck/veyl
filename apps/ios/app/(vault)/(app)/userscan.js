import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { makeQr, makeUserQr, qr } from '@veyl/shared/qr';

import Avatar from '@/components/avatar';
import { useTheme } from '@/providers/themeprovider';
import { useUser } from '@/providers/userprovider';

export default function UserScanScreen() {
    const { theme } = useTheme();
    const { username, avatar, active } = useUser();
    const [qrSize, setQrSize] = useState(0);
    const avatarSource = avatar ? { uri: avatar } : null;
    const title = username ? `@${username}` : 'share your veyl';
    const qrValue = useMemo(() => {
        if (!username) return null;
        const qrData = makeUserQr({ username });
        if (!qrData) return null;
        return makeQr({ type: qr.user, value: qrData });
    }, [username]);
    const updateQrSize = (event) => {
        const width = Math.floor(event.nativeEvent.layout.width);
        if (width > 0 && width !== qrSize) {
            setQrSize(width);
        }
    };

    if (!qrValue) {
        return (
            <View style={{ alignItems: 'center', paddingHorizontal: 48, paddingTop: 24 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.muted }}>profile not ready</Text>
            </View>
        );
    }

    return (
        <View style={{ alignItems: 'center', paddingHorizontal: 48, paddingTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 16 }}>
                <Avatar source={avatarSource} active={!!active} size={56} />
                <Text style={{ fontSize: 30, fontWeight: '900', color: theme.foreground, textAlign: 'center' }}>{title}</Text>
            </View>
            <View style={{ alignSelf: 'stretch', alignItems: 'center' }} onLayout={updateQrSize}>
                {qrSize > 0 ? <QRCode value={qrValue} size={qrSize} backgroundColor="transparent" color={theme.foreground} /> : null}
            </View>
        </View>
    );
}
