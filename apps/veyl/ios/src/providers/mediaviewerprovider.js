import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { FullscreenRail } from '@/components/media/mediaviewer';

const MediaViewerContext = createContext(null);

export function MediaViewerProvider({ children }) {
    const [items, setItems] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const itemsRef = useRef([]);

    const setMediaItems = useCallback((nextItems) => {
        const seen = new Set();
        const cleanItems = [];

        for (const item of Array.isArray(nextItems) ? nextItems : []) {
            const id = typeof item?.id === 'string' ? item.id.trim() : '';
            if (!id || seen.has(id) || (item?.type !== 'img' && item?.type !== 'mp4')) {
                continue;
            }
            seen.add(id);
            cleanItems.push({ ...item, id });
        }

        itemsRef.current = cleanItems;
        setItems(cleanItems);
    }, []);

    const openMedia = useCallback((id) => {
        const key = typeof id === 'string' ? id.trim() : '';
        if (!key || !itemsRef.current.some((item) => item.id === key)) {
            return false;
        }
        setActiveId(key);
        return true;
    }, []);

    const closeMedia = useCallback((id) => {
        setActiveId((current) => {
            if (!current || (id && current !== id)) {
                return current;
            }
            return null;
        });
    }, []);

    const activeIndex = useMemo(() => (activeId ? items.findIndex((item) => item.id === activeId) : -1), [activeId, items]);

    useEffect(() => {
        if (activeId && activeIndex === -1) {
            setActiveId(null);
        }
    }, [activeId, activeIndex]);

    const moveMedia = useCallback((step) => {
        setActiveId((current) => {
            const currentIndex = itemsRef.current.findIndex((item) => item.id === current);
            const next = itemsRef.current[currentIndex + step];
            return next?.id || current;
        });
    }, []);

    const value = useMemo(
        () => ({
            activeMediaId: activeId,
            activeVideoId: activeId,
            setMediaItems,
            openMedia,
            closeMedia,
            openVideo: (item) => openMedia(item?.id),
            closeVideo: closeMedia,
        }),
        [activeId, closeMedia, openMedia, setMediaItems]
    );

    return (
        <MediaViewerContext.Provider value={value}>
            <View style={{ flex: 1 }}>
                {children}
                {activeIndex >= 0 ? <FullscreenRail activeIndex={activeIndex} items={items} onMove={moveMedia} onCloseComplete={() => setActiveId(null)} /> : null}
            </View>
        </MediaViewerContext.Provider>
    );
}

export function useMediaViewer() {
    const ctx = useContext(MediaViewerContext);
    if (!ctx) {
        throw new Error('useMediaViewer must be used within a MediaViewerProvider');
    }
    return ctx;
}
