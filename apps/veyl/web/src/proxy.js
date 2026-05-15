import { NextResponse, userAgent } from 'next/server';

const PUBLIC_FILE = /\.(.*)$/;

export function proxy(request) {
    const { pathname } = request.nextUrl;

    if (pathname === '/download' || pathname.startsWith('/_next') || pathname.startsWith('/api') || PUBLIC_FILE.test(pathname)) {
        return NextResponse.next();
    }

    if (!['mobile', 'tablet'].includes(userAgent(request).device.type)) {
        return NextResponse.next();
    }

    return NextResponse.redirect(new URL('/download', request.url));
}

export const config = {
    matcher: '/:path*',
};
