'use client';

import { createFirebaseCloud } from '@veyl/shared/cloud/firebase';
import { auth, db, getFunctions, getStorage } from '@/lib/firebase/firebaseclient';

export const cloud = createFirebaseCloud({ auth, db, getFunctions, getStorage });
