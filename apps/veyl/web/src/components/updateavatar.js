'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { X } from 'lucide-react';

export default function UpdateAvatar({
    currentAvatar = null,
    onImageSelect = () => {},
    onImageUpload = () => {},
    onRemove = null,
    className = '',
    disabled = false,
    removeDisabled = false,
    showRemove = false,
    selectedImage: externalSelectedImage,
}) {
    const fileInputRef = useRef(null);
    const rootRef = useRef(null);
    const [internalSelectedImage, setInternalSelectedImage] = useState(null);
    const [isHoveringAvatar, setIsHoveringAvatar] = useState(false);
    const [isPressingAvatar, setIsPressingAvatar] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [avatarSize, setAvatarSize] = useState(48);
    const isSelectedImageControlled = externalSelectedImage !== undefined;
    const selectedImage = isSelectedImageControlled ? externalSelectedImage : internalSelectedImage;
    const avatarView = selectedImage ? 'selected' : currentAvatar ? 'current' : 'empty';
    const canRemove = showRemove && typeof onRemove === 'function';
    const removeOpen = canRemove && !disabled && !removeDisabled;
    const removeMetrics = useMemo(() => {
        const sizeRatio = Math.max(1, avatarSize) / 48;
        const buttonScale = Math.sqrt(sizeRatio);
        const iconScale = Math.pow(sizeRatio, 0.25);
        const button = Math.round(22 * buttonScale);
        const ring = Math.max(2, Math.round(2 * buttonScale));
        const icon = Math.round(14 * iconScale);
        return { button, ring, icon };
    }, [avatarSize]);

    useEffect(() => {
        if (!selectedImage && fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [selectedImage]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === 'undefined') return;

        const updateSize = () => {
            const width = root.getBoundingClientRect().width;
            if (width > 0) {
                setAvatarSize(Math.round(width));
            }
        };
        updateSize();

        const observer = new ResizeObserver(updateSize);
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

    const handleFileSelect = (file) => {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const imageData = e.target.result;
                if (isSelectedImageControlled) {
                    onImageSelect(imageData);
                } else {
                    setInternalSelectedImage(imageData);
                    onImageSelect(imageData);
                }
                onImageUpload(imageData);
            };
            reader.readAsDataURL(file);
        }
    };
    const handleFileInputChange = (e) => {
        const file = e.target.files?.[0];
        if (file) handleFileSelect(file);
    };

    const isInAvatarCircle = useCallback((event) => {
        const root = rootRef.current;
        if (!root) return false;

        const rect = root.getBoundingClientRect();
        const radius = Math.min(rect.width, rect.height) / 2;
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        return dx * dx + dy * dy <= radius * radius;
    }, []);

    const updateAvatarHover = useCallback(
        (event) => {
            const hovering = !disabled && isInAvatarCircle(event);
            setIsHoveringAvatar(hovering);
            return hovering;
        },
        [disabled, isInAvatarCircle]
    );

    const clearAvatarHover = useCallback(() => {
        setIsHoveringAvatar(false);
        setIsPressingAvatar(false);
        setIsDragOver(false);
    }, []);

    return (
        <>
            <div ref={rootRef} className={`${className} relative inline-flex shrink-0 overflow-visible`}>
                <Avatar
                    key={avatarView}
                    className={`size-full ${!selectedImage && !currentAvatar ? 'shadow text-muted' : ''} transition-all ${
                        disabled || !isHoveringAvatar ? 'cursor-default' : 'cursor-pointer'
                    } ${isHoveringAvatar ? 'scale-95 text-foreground' : ''} ${isPressingAvatar || isDragOver ? 'scale-85 text-foreground' : ''}`}
                    onClick={(event) => {
                        if (disabled || !isInAvatarCircle(event)) return;
                        fileInputRef.current?.click();
                    }}
                    onPointerEnter={updateAvatarHover}
                    onPointerMove={updateAvatarHover}
                    onPointerLeave={clearAvatarHover}
                    onPointerDown={(event) => {
                        if (updateAvatarHover(event)) {
                            setIsPressingAvatar(true);
                        }
                    }}
                    onPointerUp={(event) => {
                        setIsPressingAvatar(false);
                        updateAvatarHover(event);
                    }}
                    onPointerCancel={clearAvatarHover}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragOver(!disabled && isInAvatarCircle(e));
                    }}
                    onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (!disabled && isInAvatarCircle(e)) {
                            const file = e.dataTransfer.files?.[0];
                            if (file) {
                                handleFileSelect(file);
                            }
                        }
                    }}
                >
                    {selectedImage ? (
                        <AvatarImage src={selectedImage} alt="selected avatar" className="object-cover" />
                    ) : currentAvatar ? (
                        <AvatarImage src={currentAvatar} alt="current avatar" className="object-cover" />
                    ) : (
                        <AvatarFallback />
                    )}
                </Avatar>
                {typeof onRemove === 'function' ? (
                    <div className="absolute left-[calc(50%+35.355%)] top-[calc(50%-35.355%)] z-20 -translate-x-1/2 -translate-y-1/2">
                        <div className="pop" data-open={removeOpen}>
                            <Button
                                aria-label="remove avatar"
                                aria-disabled={!removeOpen}
                                className="grower rounded-full bg-destructive p-0 text-background shadow disabled:hover:scale-100"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (!removeOpen) return;
                                    onRemove();
                                }}
                                tabIndex={removeOpen ? 0 : -1}
                                title="remove avatar"
                                type="button"
                                style={{
                                    width: removeMetrics.button,
                                    height: removeMetrics.button,
                                    boxShadow: `0 0 0 ${removeMetrics.ring}px var(--background), 0px 0px 8px 0px var(--shadow)`,
                                }}
                            >
                                <X strokeWidth={4} style={{ width: removeMetrics.icon, height: removeMetrics.icon }} />
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
            <Input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" onChange={handleFileInputChange} className="hidden" disabled={disabled} />
        </>
    );
}
