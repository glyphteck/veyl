import { NextResponse } from 'next/server';
import { z } from 'zod';
import admin from '@/lib/firebase/firebaseadmin';

const sessionRequestSchema = z.object({
    idToken: z.string().min(1),
});

function isSameOriginRequest(request) {
    const origin = request.headers.get('origin');
    if (!origin) {
        return true;
    }

    try {
        return origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function clearSessionCookie(response) {
    response.cookies.set({
        name: 'session',
        value: '',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
    });
    return response;
}

export async function POST(request) {
    if (!isSameOriginRequest(request)) {
        return NextResponse.json({ error: 'invalid session origin' }, { status: 403 });
    }

    const parsed = sessionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'invalid session request' }, { status: 400 });
    }

    const { idToken } = parsed.data;
    const expiresIn = 5 * 24 * 60 * 60 * 1000;
    const session = await admin.auth().createSessionCookie(idToken, { expiresIn });
    const response = NextResponse.json({ status: 'success' });

    response.cookies.set({
        name: 'session',
        value: session,
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
    });

    return response;
}

export async function DELETE() {
    return clearSessionCookie(NextResponse.json({ status: 'logged out' }));
}
