'use client';

function FeatureJump({ target, children }) {
    function jump() {
        document.getElementById(target)?.scrollIntoView({ block: 'start' });
    }

    return (
        <button type="button" className="group block h-full w-full cursor-pointer rounded-round text-left transition-transform focus-visible:scale-95" onClick={jump}>
            {children}
        </button>
    );
}

export { FeatureJump };
