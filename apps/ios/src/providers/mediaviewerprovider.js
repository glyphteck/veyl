import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { cleanText } from '@veyl/shared/utils/text';
import { FullscreenRail } from '@/components/media/mediaviewer';

const MediaViewerContext = createContext(null);

export function MediaViewerProvider({ children }) {
    const [items, setItems] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [railId, setRailId] = useState(null);
    const [openSeq, setOpenSeq] = useState(0);
    const activeIdRef = useRef(null);
    const railIdRef = useRef(null);
    const itemsRef = useRef([]);

    const setMediaItems = useCallback((nextItems) => {
        const seen = new Set();
        const cleanItems = [];

        for (const item of Array.isArray(nextItems) ? nextItems : []) {
            const id = cleanText(item?.id);
            if (!id || seen.has(id) || (item?.type !== 'img' && item?.type !== 'gif' && item?.type !== 'mp4')) {
                continue;
            }
            seen.add(id);
            cleanItems.push({ ...item, id });
        }

        itemsRef.current = cleanItems;
        setItems(cleanItems);
    }, []);

    const openMedia = useCallback((id) => {
        const key = cleanText(id);
        if (!key || !itemsRef.current.some((item) => item.id === key)) {
            return false;
        }
        if (activeIdRef.current === key) {
            return true;
        }
        railIdRef.current = key;
        activeIdRef.current = key;
        setRailId(key);
        setActiveId(key);
        setOpenSeq((current) => current + 1);
        return true;
    }, []);

    const closeMedia = useCallback((id) => {
        setRailId((current) => {
            if (!current || (id && current !== id)) {
                return current;
            }
            railIdRef.current = null;
            return null;
        });
        setActiveId((current) => {
            if (!current || (id && current !== id)) {
                return current;
            }
            activeIdRef.current = null;
            return null;
        });
    }, []);

    const activeIndex = useMemo(() => (railId ? items.findIndex((item) => item.id === railId) : -1), [items, railId]);

    useEffect(() => {
        if (railId && activeIndex === -1) {
            railIdRef.current = null;
            activeIdRef.current = null;
            setRailId(null);
            setActiveId(null);
        }
    }, [activeIndex, railId]);

    const moveMedia = useCallback(
        (step) => {
            const currentIndex = itemsRef.current.findIndex((item) => item.id === railId);
            const next = itemsRef.current[currentIndex + step];
            if (!next?.id) {
                return;
            }
            railIdRef.current = next.id;
            activeIdRef.current = next.id;
            setRailId(next.id);
            setActiveId(next.id);
        },
        [railId]
    );

    const handleCloseStart = useCallback(() => {
        activeIdRef.current = null;
        setActiveId(null);
    }, []);

    const handleCloseComplete = useCallback(() => {
        railIdRef.current = null;
        activeIdRef.current = null;
        setRailId(null);
        setActiveId(null);
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
                {activeIndex >= 0 ? <FullscreenRail key={`viewer:${openSeq}`} activeIndex={activeIndex} items={items} onMove={moveMedia} onCloseStart={handleCloseStart} onCloseComplete={handleCloseComplete} /> : null}
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
