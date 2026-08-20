import { createRequire } from 'node:module';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const require = createRequire(import.meta.url);
const { configstore } = require('/usr/local/lib/node_modules/firebase-tools/lib/configstore');
const firebaseCliAuth = require('/usr/local/lib/node_modules/firebase-tools/lib/auth');
const firebaseScopes = require('/usr/local/lib/node_modules/firebase-tools/lib/scopes');

const projectId = 'aqueous-thought-498514-m3';
const databaseId = 'timmo-hrm-prod';
const email = 'admin@gmail.com';

const toFirestoreValue = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
};

const cliTokens = configstore.get('tokens');
if (!cliTokens?.refresh_token) {
  throw new Error('Firebase CLI is not authenticated');
}

const oauthToken = await firebaseCliAuth.getAccessToken(cliTokens.refresh_token, [
  firebaseScopes.CLOUD_PLATFORM,
]);

const credential = {
  getAccessToken: async () => ({
    access_token: oauthToken.access_token,
    expires_in: Math.max(
      60,
      Math.floor(((oauthToken.expires_at ?? Date.now() + 3_600_000) - Date.now()) / 1000),
    ),
  }),
};

const app = initializeApp({ projectId, credential }, `booking-superadmin-${Date.now()}`);

try {
  const auth = getAuth(app);
  const firebaseUser = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(firebaseUser.uid, {
    ...(firebaseUser.customClaims ?? {}),
    role: 'admin',
  });

  const now = Date.now();
  const profile = {
    uid: firebaseUser.uid,
    email,
    ownerId: firebaseUser.uid,
    role: 'admin',
    active: true,
    name: firebaseUser.displayName || 'Demo Admin',
    displayName: firebaseUser.displayName || 'Demo Admin',
    updatedAt: now,
    updatedByUserId: firebaseUser.uid,
  };
  const profileUrl = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${firebaseUser.uid}`,
  );
  for (const field of Object.keys(profile)) {
    profileUrl.searchParams.append('updateMask.fieldPaths', field);
  }
  const response = await fetch(profileUrl, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${oauthToken.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(profile).map(([key, value]) => [key, toFirestoreValue(value)]),
      ),
    }),
  });
  if (!response.ok) {
    throw new Error(`Firestore profile write failed (${response.status}): ${await response.text()}`);
  }

  console.log(`Super admin profile is ready for ${email} (${firebaseUser.uid}).`);
} finally {
  await deleteApp(app);
}
