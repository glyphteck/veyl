import * as React from 'react';

import { cn } from '@/lib/utils';

function composeEventHandlers(theirs, ours) {
    return (event) => {
        theirs?.(event);
        ours?.(event);
    };
}

const baseClassName =
    'transition-all cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-none';

const Button = React.forwardRef(function Button({ className, asChild = false, variant: _variant, children, ...props }, ref) {
    const classes = cn(baseClassName, className);

    if (!asChild) {
        return (
            <button ref={ref} className={classes} {...props}>
                {children}
            </button>
        );
    }

    const child = React.Children.only(children);

    if (!React.isValidElement(child)) {
        return null;
    }

    return React.cloneElement(child, {
        ...props,
        ...child.props,
        ref,
        className: cn(classes, child.props.className),
        onClick: composeEventHandlers(child.props.onClick, props.onClick),
    });
});

export { Button };
