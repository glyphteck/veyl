import { ArrowUpRight, Download, X } from 'lucide-react';

export function CameraActions({ actionRefs, initialSendFocus, onDiscard, onSave, onSend }) {
    return (
        <>
            <button
                ref={(node) => {
                    actionRefs.current[0] = node;
                }}
                type="button"
                onClick={onDiscard}
                className="backdrop-blur-sm size-12 rounded-full bg-background/70 grower cursor-pointer flex items-center justify-center"
            >
                <X className="size-5 text-foreground" />
            </button>
            <button
                ref={(node) => {
                    actionRefs.current[1] = node;
                }}
                type="button"
                onClick={onSend}
                data-initial-focus={initialSendFocus}
                className="backdrop-blur-sm size-18 rounded-full bg-foreground/70 grower data-[initial-focus=true]:focus-visible:scale-100 cursor-pointer flex items-center justify-center"
            >
                <ArrowUpRight className="size-8 text-background" />
            </button>
            <button
                ref={(node) => {
                    actionRefs.current[2] = node;
                }}
                type="button"
                onClick={onSave}
                className="backdrop-blur-sm size-12 rounded-full bg-background/70 grower cursor-pointer flex items-center justify-center"
            >
                <Download className="size-5 text-foreground" />
            </button>
        </>
    );
}
