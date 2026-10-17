export function normalizePublicUrl(value) {
    return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}
