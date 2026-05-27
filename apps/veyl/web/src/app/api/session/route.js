import { NextResponse } from 'next/server';
import admin from '@/lib/firebase/firebaseadmin';

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
    const { idToken } = await request.json();
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
