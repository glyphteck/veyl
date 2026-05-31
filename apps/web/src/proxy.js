import { NextResponse, userAgent } from 'next/server';

const PUBLIC_FILE = /\.(.*)$/;

export function proxy(request) {
    const { pathname } = request.nextUrl;

    if (pathname.startsWith('/_next') || pathname.startsWith('/api') || PUBLIC_FILE.test(pathname)) {
        return NextResponse.next();
    }

    const isMobile = ['mobile', 'tablet'].includes(userAgent(request).device.type);

    if (pathname === '/landing') {
        return NextResponse.next();
    }

    if (pathname === '/') {
        return isMobile ? NextResponse.redirect(new URL('/landing', request.url)) : NextResponse.next();
    }

    if (pathname === '/download') {
        return isMobile ? NextResponse.next() : NextResponse.redirect(new URL('/', request.url));
    }

    if (!isMobile) {
        return NextResponse.next();
    }

    return NextResponse.redirect(new URL('/download', request.url));
}

export const config = {
    matcher: '/:path*',
};
