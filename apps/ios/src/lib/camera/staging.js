import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { randomFilename } from '@veyl/shared/utils/filename';
import { fileUri } from '@/lib/file';

const VIDEO_MIME = 'video/mp4';
const VIDEO_LANDSCAPE_SIZE = { width: 1280, height: 720 };
const VIDEO_PORTRAIT_SIZE = { width: 720, height: 1280 };

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

function getVideoDisplaySize(orientation) {
    return orientation === 'left' || orientation === 'right' ? VIDEO_LANDSCAPE_SIZE : VIDEO_PORTRAIT_SIZE;
}

function getContainedSize(screenW, screenH, width, height) {
    const mediaW = Math.max(1, Number(width) || VIDEO_PORTRAIT_SIZE.width);
    const mediaH = Math.max(1, Number(height) || VIDEO_PORTRAIT_SIZE.height);
    const aspect = mediaW / mediaH;
    let frameW = screenW;
    let frameH = frameW / aspect;
    if (frameH > screenH) {
        frameH = screenH;
        frameW = frameH * aspect;
    }
    return {
        width: Math.max(1, Math.round(frameW)),
        height: Math.max(1, Math.round(frameH)),
    };
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
    const size = getVideoDisplaySize(orientation);
    return {
        kind: 'video',
        uri,
        mimeType: VIDEO_MIME,
        name: randomFilename('mp4'),
        width: size.width,
        height: size.height,
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

function StagedVideoPreview({ media }) {
    const { width: screenW, height: screenH } = useWindowDimensions();
    const frame = getContainedSize(screenW, screenH, media?.width, media?.height);
    const player = useVideoPlayer(media?.uri ? { uri: media.uri } : null, (nextPlayer) => {
        nextPlayer.loop = true;
        nextPlayer.muted = true;
        nextPlayer.audioMixingMode = 'mixWithOthers';
    });

    useEffect(() => {
        if (!media?.uri) return undefined;
        try {
            player.play();
        } catch (error) {
            console.warn('video preview failed', error);
        }
        return undefined;
    }, [media?.uri, player]);

    return (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <VideoView player={player} pointerEvents="none" nativeControls={false} contentFit="contain" fullscreenOptions={{ enable: false }} allowsVideoFrameAnalysis={false} style={frame} />
        </View>
    );
}

export function StagedPreview({ media }) {
    if (media?.kind === 'video') {
        return <StagedVideoPreview media={media} />;
    }

    return (
        <StagedMediaFrame rotate={media?.rotate || '0deg'}>
            <Image source={{ uri: media?.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
        </StagedMediaFrame>
    );
}
