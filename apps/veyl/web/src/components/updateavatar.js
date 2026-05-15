'use client';

import React, { useState, useRef } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/avatar';
import { Input } from '@/components/input';

export default function UpdateAvatar({ currentAvatar = null, onImageSelect = () => {}, onImageUpload = () => {}, className = '', disabled = false, selectedImage: externalSelectedImage = null }) {
    const fileInputRef = useRef(null);
    const [internalSelectedImage, setInternalSelectedImage] = useState(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const selectedImage = externalSelectedImage !== null ? externalSelectedImage : internalSelectedImage;
    const handleFileSelect = (file) => {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const imageData = e.target.result;
                if (externalSelectedImage !== null) {
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
    return (
        <>
            <Avatar
                className={`${className} ${!selectedImage && !currentAvatar ? 'shadow text-muted' : ''} transition-all ${
                    disabled ? 'cursor-default' : 'cursor-pointer hover:text-foreground shrinker'
                } ${isDragOver && !disabled ? 'scale-85 text-foreground' : ''}`}
                onClick={() => {
                    if (disabled) return;
                    fileInputRef.current?.click();
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    if (!disabled) {
                        setIsDragOver(true);
                    }
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    if (!disabled) {
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
            <Input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" onChange={handleFileInputChange} className="hidden" disabled={disabled} />
        </>
    );
}
