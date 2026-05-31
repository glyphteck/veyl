import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { resolveMessageFileUri } from '@/lib/chat/downloads';
import { getMediaAspect, getMediaOrientation, getMediaRect, getViewerLayout } from '@/lib/media/mediaviewer';
import { ImageSlide } from './image';
import { VideoSlide } from './video';

const RENDER_RADIUS = 2;

function useResolvedMediaUri(item, label) {
    const [uri, setUri] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        setUri(null);
        setLoading(true);
        setError('');
        resolveMessageFileUri(item.msg, item.peerChatPK, item.readMessageFile)
            .then((nextUri) => {
                if (cancelled) {
                    return;
                }
                setUri(nextUri);
                setLoading(false);
            })
            .catch((nextError) => {
                if (cancelled) {
                    return;
                }
                console.warn(`chat ${label} viewer load failed`, nextError);
                setError(nextError?.message || `${label} unavailable`);
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [item.id, item.msg, item.peerChatPK, item.readMessageFile, label]);

    return { uri, loading, error, setError };
}

function MediaSlide({ active, item, screenW, screenH, mediaStyle, swipeStyle, registerVideo, onReady, playAllowed, muted }) {
    const video = item.type === 'mp4';
    const aspect = getMediaAspect(item);
    const source = useResolvedMediaUri(item, video ? 'video' : 'image');
    const layout = useMemo(() => getViewerLayout(screenW, screenH, aspect, getMediaOrientation(item, aspect)), [aspect, item, screenH, screenW]);
    const rect = getMediaRect(layout.stageW, layout.stageH, aspect);

    return (
        <View
            style={{
                position: 'absolute',
                left: layout.stageLeft,
                top: layout.stageTop,
                width: layout.stageW,
                height: layout.stageH,
                transform: [{ rotate: layout.rotate }],
            }}
        >
            <Animated.View
                style={[
                    {
                        position: 'absolute',
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                    },
                    swipeStyle,
                ]}
            >
                <Animated.View style={[{ width: '100%', height: '100%' }, active ? mediaStyle : null]}>
                    {video ? (
                        <VideoSlide active={active} item={item} rect={rect} registerVideo={registerVideo} onReady={onReady} playAllowed={playAllowed} muted={muted} source={source} />
                    ) : (
                        <ImageSlide active={active} onReady={onReady} source={source} />
                    )}
                </Animated.View>
            </Animated.View>
        </View>
    );
}

export function MediaSlider({ activeIndex, gesture, items, mediaH, mediaStyle, muted, onReady, playAllowed, railStyle, registerVideo, screenW, slideW, swipeStyle }) {
    const visibleItems = useMemo(() => items.map((item, index) => ({ item, index })).filter(({ index }) => Math.abs(index - activeIndex) <= RENDER_RADIUS), [activeIndex, items]);

    return (
        <GestureDetector gesture={gesture}>
            <View style={{ width: screenW, height: mediaH, overflow: 'visible' }}>
                <Animated.View style={[{ width: screenW, height: mediaH, overflow: 'visible' }, railStyle]}>
                    {visibleItems.map(({ item, index }) => (
                        <View
                            key={item.id}
                            style={{
                                position: 'absolute',
                                left: index * slideW,
                                top: 0,
                                width: screenW,
                                height: mediaH,
                                overflow: 'visible',
                            }}
                        >
                            <MediaSlide
                                active={index === activeIndex}
                                item={item}
                                screenW={screenW}
                                screenH={mediaH}
                                mediaStyle={mediaStyle}
                                swipeStyle={swipeStyle}
                                registerVideo={registerVideo}
                                onReady={onReady}
                                playAllowed={playAllowed}
                                muted={muted}
                            />
                        </View>
                    ))}
                </Animated.View>
            </View>
        </GestureDetector>
    );
}
