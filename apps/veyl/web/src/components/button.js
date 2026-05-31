import * as React from 'react';

import { cn } from '@/lib/classes';

function composeEventHandlers(theirs, ours) {
    return (event) => {
        theirs?.(event);
        ours?.(event);
    };
}

const baseClassName =
    'transition-all cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-none';

const Button = React.forwardRef(function Button({ className, asChild = false, variant: _variant, children, tabbable = true, tabIndex, ...props }, ref) {
    const classes = cn(baseClassName, className);
    const nextTabIndex = tabbable === false ? -1 : tabIndex;

    if (!asChild) {
        return (
            <button ref={ref} className={classes} tabIndex={nextTabIndex} {...props}>
                {children}
            </button>
        );
    }

    const child = React.Children.only(children);

    if (!React.isValidElement(child)) {
        return null;
    }

    const nextProps = {
        ...props,
        ...child.props,
        ref,
        className: cn(classes, child.props.className),
    };
    if (tabbable === false) {
        nextProps.tabIndex = -1;
    } else if (tabIndex != null) {
        nextProps.tabIndex = tabIndex;
    }

    if (props.onClick || child.props.onClick) {
        nextProps.onClick = composeEventHandlers(child.props.onClick, props.onClick);
    }

    return React.cloneElement(child, nextProps);
});

export { Button };
