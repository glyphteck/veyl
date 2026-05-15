'use client';

import { useParams } from 'next/navigation';

export default function UserPage() {
    const { username } = useParams();

    return (
        <div className="fixed inset-0 text-center flex flex-col items-center justify-center text-7xl space-y-4">
            {username}
        </div>
    );
}
