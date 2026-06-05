import { createFirebaseCloud } from '@veyl/shared/cloud/firebase';
import { auth, db, functions, storage } from '@/lib/firebase';
import { uploadSignedStorageBytesNative, uploadStorageBytesNative } from '@/lib/cloud/storage';

export const cloud = createFirebaseCloud({ auth, db, functions, storage, uploadStorageBytes: uploadStorageBytesNative, uploadSignedStorageBytes: uploadSignedStorageBytesNative });
