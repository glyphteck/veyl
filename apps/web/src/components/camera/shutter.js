import { forwardRef } from 'react';
import { Lock } from 'lucide-react';

export const CameraShutter = forwardRef(function CameraShutter(
    {
        onBlur,
        onKeyDown,
        onKeyUp,
        onLostPointerCapture,
        onPointerCancel,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        pressed,
        recording,
        recordingLocked,
    },
    ref
) {
    return (
        <button
            ref={ref}
            type="button"
            aria-label={recordingLocked ? 'stop recording' : recording ? 'recording video' : 'take photo'}
            autoFocus
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onLostPointerCapture}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={onBlur}
            data-pressed={pressed}
            data-locked={recordingLocked}
            className={`backdrop-blur-md size-18 rounded-full shadow cursor-pointer transition-transform hover:scale-120 active:scale-85 data-[pressed=true]:scale-85 data-[locked=true]:scale-90 flex items-center justify-center ${recording ? 'bg-destructive/75' : 'bg-background/70'}`}
        >
            {recordingLocked ? <Lock className="pointer-events-none size-6 text-foreground" strokeWidth={3} /> : null}
        </button>
    );
});
