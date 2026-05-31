import { useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { randomFilename } from '@veyl/shared/utils/filename';
import { fileUri } from '@/lib/file';

const VIDEO_MIME = 'video/mp4';

function getPhotoDisplaySize(photo) {
    const width = Math.max(1, Math.round(Number(photo?.width) || 0));
    const height = Math.max(1, Math.round(Number(photo?.height) || 0));
    return photo?.orientation === 'left' || photo?.orientation === 'right'
        ? { width: height, height: width }
        : { width, height };
}

function getCaptureRotate(orientation) {
    if (orientation === 'left') return '90deg';
    if (orientation === 'right') return '-90deg';
    if (orientation === 'down') return '180deg';
    return '0deg';
}

export function stageCapturedPhoto(photo, uri, orientation) {
    const size = getPhotoDisplaySize(photo);
    return {
        uri,
        width: size.width,
        height: size.height,
        name: randomFilename('jpg'),
        rotate: getCaptureRotate(orientation || photo?.orientation),
    };
}

export function stageCapturedVideo(path, orientation) {
    const uri = fileUri(path);
    if (!uri) {
        throw new Error('video unavailable');
    }
    return {
        kind: 'video',
        uri,
        mimeType: VIDEO_MIME,
        name: randomFilename('mp4'),
        rotate: getCaptureRotate(orientation),
    };
}

function StagedMediaFrame({ rotate, children }) {
    const { width: screenW, height: screenH } = useWindowDimensions();
    const sideways = rotate === '90deg' || rotate === '-90deg';

    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: sideways ? (screenW - screenH) / 2 : 0,
                top: sideways ? (screenH - screenW) / 2 : 0,
                width: sideways ? screenH : screenW,
                height: sideways ? screenW : screenH,
                transform: [{ rotate }],
            }}
        >
            {children}
        </View>
    );
}

function StagedVideoPreview({ uri }) {
    const player = useVideoPlayer(uri ? { uri } : null, (nextPlayer) => {
        nextPlayer.loop = true;
        nextPlayer.muted = true;
        nextPlayer.audioMixingMode = 'mixWithOthers';
    });

    useEffect(() => {
        if (!uri) return undefined;
        try {
            player.play();
        } catch (error) {
            console.warn('video preview failed', error);
        }
        return undefined;
    }, [player, uri]);

    return <VideoView player={player} pointerEvents="none" nativeControls={false} contentFit="contain" fullscreenOptions={{ enable: false }} allowsVideoFrameAnalysis={false} style={{ width: '100%', height: '100%' }} />;
}

export function StagedPreview({ media }) {
    return (
        <StagedMediaFrame rotate={media?.rotate || '0deg'}>
            {media?.kind === 'video' ? <StagedVideoPreview uri={media.uri} /> : <Image source={{ uri: media?.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />}
        </StagedMediaFrame>
    );
}
