export function saveUrl(url, name = 'download') {
    if (!url) {
        return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
}

export function saveBytes(bytes, { name = 'download', type = 'application/octet-stream' } = {}) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    saveUrl(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
