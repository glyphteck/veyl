'use client';

import * as React from 'react';
import { Controller } from 'react-hook-form';

function Field({ control, name, render, ...props }) {
    const baseId = React.useId().replace(/:/g, '');
    const inputId = `${baseId}-field`;
    const labelId = `${baseId}-label`;
    const hintId = `${baseId}-hint`;

    return (
        <Controller
            control={control}
            name={name}
            render={(controller) =>
                render({
                    ...controller,
                    ids: {
                        input: inputId,
                        label: labelId,
                        hint: hintId,
                    },
                    labelProps: {
                        id: labelId,
                        htmlFor: inputId,
                    },
                    inputProps: {
                        id: inputId,
                        'aria-describedby': hintId,
                        'aria-invalid': controller.fieldState.invalid,
                    },
                    controlProps: {
                        id: inputId,
                        'aria-labelledby': labelId,
                        'aria-describedby': hintId,
                        'aria-invalid': controller.fieldState.invalid,
                    },
                    hintProps: {
                        id: hintId,
                    },
                })
            }
            {...props}
        />
    );
}

export { Field };
