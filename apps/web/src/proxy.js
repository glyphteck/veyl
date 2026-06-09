import { NextResponse, userAgent } from 'next/server';

const PUBLIC_FILE = /\.(.*)$/;
const origins = [
    'https://*.googleapis.com',
    'https://firebasestorage.googleapis.com',
    'https://storage.googleapis.com',
    'https://*.firebasestorage.app',
    'https://*.firebaseio.com',
    'https://firestore.googleapis.com',
    'https://*.cloudfunctions.net',
    'https://buildonspark.com',
    'https://api.lightspark.com',
    'https://*.spark.lightspark.com',
    'https://*.spark.flashnet.xyz',
    'https://spark-operator.breez.technology',
    'https://*.sparkinfra.net',
    'https://fastly.jsdelivr.net',
    'wss://*.spark.lightspark.com',
    'wss://*.spark.flashnet.xyz',
];

function requestNonce() {
    return btoa(crypto.randomUUID());
}

function contentSecurityPolicy(nonce) {
    const isDev = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_NETWORK === 'REGTEST';
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/${isDev ? " 'unsafe-eval'" : ''}`,
        "script-src-attr 'none'",
        `connect-src 'self' https://www.google.com/recaptcha/ ${origins.join(' ')}`,
        "img-src 'self' data: blob: https://firebasestorage.googleapis.com",
        "media-src 'self' data: blob:",
        "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
        `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
        "style-src-attr 'unsafe-inline'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "manifest-src 'self'",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
    ].join('; ');
}

function secureNext(request) {
    const nonce = requestNonce();
    const csp = contentSecurityPolicy(nonce);
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);
    const response = NextResponse.next({
        request: { headers },
    });
    response.headers.set('Content-Security-Policy', csp);
    return response;
}

function secureRedirect(request, pathname) {
    const nonce = requestNonce();
    const response = NextResponse.redirect(new URL(pathname, request.url));
    response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
    return response;
}

export function proxy(request) {
    const { pathname } = request.nextUrl;

    if (pathname.startsWith('/_next') || pathname.startsWith('/api') || PUBLIC_FILE.test(pathname)) {
        return NextResponse.next();
    }

    const isMobile = ['mobile', 'tablet'].includes(userAgent(request).device.type);

    if (pathname === '/landing') {
        return secureNext(request);
    }

    if (pathname === '/') {
        return isMobile ? secureRedirect(request, '/landing') : secureNext(request);
    }

    if (pathname === '/download') {
        return isMobile ? secureNext(request) : secureRedirect(request, '/');
    }

    if (!isMobile) {
        return secureNext(request);
    }

    return secureRedirect(request, '/download');
}

export const config = {
    matcher: [
        {
            source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
            missing: [
                { type: 'header', key: 'next-router-prefetch' },
                { type: 'header', key: 'purpose', value: 'prefetch' },
            ],
        },
    ],
};
