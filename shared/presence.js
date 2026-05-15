import { doc, setDoc, updateDoc } from 'firebase/firestore';

export async function writePresence(db, uid, active) {
    if (!db || !uid) {
        return false;
    }

    const ref = doc(db, 'profiles', uid);

    if (active) {
        await setDoc(ref, { active: true }, { merge: true });
        return true;
    }

    try {
        await updateDoc(ref, { active: false });
        return true;
    } catch (error) {
        if (error?.code === 'not-found') {
            return false;
        }
        throw error;
    }
}
