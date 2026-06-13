import { forwardRef } from 'react';
import { StyleSheet, TextInput } from 'react-native';

const AmountInput = forwardRef(function AmountInput({ value, placeholder, placeholderTextColor, color, style, ...props }, ref) {
    return <TextInput ref={ref} {...props} value={value} placeholder={placeholder} placeholderTextColor={placeholderTextColor} style={[styles.input, { color }, style]} />;
});

export default AmountInput;

const styles = StyleSheet.create({
    input: {
        flex: 1,
        minWidth: 0,
        height: 48,
        fontSize: 24,
        lineHeight: 30,
        fontWeight: '900',
        margin: 0,
        paddingTop: 0,
        paddingBottom: 0,
        paddingVertical: 0,
        textAlignVertical: 'center',
    },
});
