import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const require = createRequire(import.meta.url);
const { configstore } = require('/usr/local/lib/node_modules/firebase-tools/lib/configstore');
const firebaseCliAuth = require('/usr/local/lib/node_modules/firebase-tools/lib/auth');
const firebaseScopes = require('/usr/local/lib/node_modules/firebase-tools/lib/scopes');
const { demoBranch, demoCategories, demoServices } = require('/tmp/timmo-booking-seed/seedData.js');

const projectId = 'aqueous-thought-498514-m3';
const bookingDatabaseId = 'timmo-prod';
const hrmDatabaseId = 'timmo-hrm-prod';
const password = process.env.TIMMO_SYNC_PASSWORD;

if (!password || password.length < 6) {
  throw new Error('TIMMO_SYNC_PASSWORD must contain at least 6 characters');
}

const cliTokens = configstore.get('tokens');
if (!cliTokens?.refresh_token) {
  throw new Error('Firebase CLI is not authenticated');
}

const oauthToken = await firebaseCliAuth.getAccessToken(
  cliTokens.refresh_token,
  [firebaseScopes.CLOUD_PLATFORM],
);

const credential = {
  getAccessToken: async () => ({
    access_token: oauthToken.access_token,
    expires_in: Math.max(
      60,
      Math.floor(((oauthToken.expires_at ?? Date.now() + 3600000) - Date.now()) / 1000),
    ),
  }),
};

const app = initializeApp({ projectId, credential }, `booking-account-sync-${Date.now()}`);
const auth = getAuth(app);

const toFirestoreValue = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, toFirestoreValue(child)]),
        ),
      },
    };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
};

const toFirestoreFields = (data) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)]),
  );

const writeDocument = async (databaseId, path, data, { merge = false } = {}) => {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${path}`,
  );
  if (merge) {
    for (const field of Object.keys(data)) {
      url.searchParams.append('updateMask.fieldPaths', field);
    }
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${oauthToken.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore write failed (${response.status}) for ${path}: ${body}`);
  }
};

const ownerId = 'gusgspKjUqbZH6LiU0iD2a1X7XG2';
const storeId = 'S-3';
const businessId = 'glamour-nails-business';
const branchId = 'glamour-nails-berlin';
const now = Date.now();
const nowIso = new Date(now).toISOString();

const accountDefinitions = [
  {
    key: 'superadmin',
    email: 'admin@gmail.com',
    displayName: 'Demo Admin',
    claims: { role: 'admin' },
  },
  {
    key: 'owner',
    email: 'chutiem@gmail.com',
    displayName: 'Chủ Tiệm',
    claims: { role: 'owner', ownerId },
  },
  {
    key: 'main',
    email: 'thochinh@gmail.com',
    displayName: 'Thợ Chính',
    claims: { role: 'employee', ownerId, storeId },
  },
  {
    key: 'assistant',
    email: 'thophu@gmail.com',
    displayName: 'Thợ Phụ',
    claims: { role: 'employee', ownerId, storeId },
  },
];

const users = {};
for (const definition of accountDefinitions) {
  let user;
  try {
    user = await auth.getUserByEmail(definition.email);
    user = await auth.updateUser(user.uid, {
      password,
      displayName: definition.displayName,
      disabled: false,
    });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw error;
    }
    user = await auth.createUser({
      email: definition.email,
      password,
      displayName: definition.displayName,
      disabled: false,
    });
  }

  if (definition.claims) {
    await auth.setCustomUserClaims(user.uid, definition.claims);
  }

  users[definition.key] = user;
}

const assistantUid = users.assistant.uid;
const mainUid = users.main.uid;

await writeDocument(
  hrmDatabaseId,
  `users/${users.superadmin.uid}`,
  {
    uid: users.superadmin.uid,
    email: 'admin@gmail.com',
    ownerId: users.superadmin.uid,
    role: 'admin',
    active: true,
    name: 'Demo Admin',
    displayName: 'Demo Admin',
    updatedAt: now,
    updatedByUserId: users.superadmin.uid,
  },
  { merge: true },
);

await writeDocument(
  hrmDatabaseId,
  `users/${users.owner.uid}`,
  {
    uid: users.owner.uid,
    email: 'chutiem@gmail.com',
    ownerId,
    role: 'owner',
    active: true,
    name: 'Chủ Tiệm',
    displayName: 'Chủ Tiệm',
    updatedAt: now,
    updatedByUserId: ownerId,
  },
  { merge: true },
);

await writeDocument(
  hrmDatabaseId,
  `users/${mainUid}`,
  {
    workerType: 'main',
    updatedAt: now,
    updatedByUserId: ownerId,
  },
  { merge: true },
);

await writeDocument(
  hrmDatabaseId,
  `users/${assistantUid}`,
  {
    uid: assistantUid,
    email: 'thophu@gmail.com',
    ownerId,
    role: 'employee',
    active: true,
    name: 'Thợ Phụ',
    displayName: 'Thợ Phụ',
    storeId,
    position: 'Nail technician',
    workerType: 'assistant',
    compensationModel: 'commission',
    ownerCommissionRate: 50,
    employeeStatus: 'active',
    serviceIds: [],
    weeklyWorkingHours: Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map((day) => [day, { enabled: true, startTime: '09:00', endTime: '21:00' }]),
    ),
    createdAt: now,
    updatedAt: now,
    createdByUserId: ownerId,
    updatedByUserId: ownerId,
  },
  { merge: true },
);

await writeDocument(
  hrmDatabaseId,
  `stores/${storeId}`,
  {
    employeeCount: 2,
    activeEmployeeCount: 2,
    inactiveEmployeeCount: 0,
    updatedAt: now,
    updatedByUserId: ownerId,
  },
  { merge: true },
);

const bookingProfiles = [
  {
    uid: users.superadmin.uid,
    email: 'admin@gmail.com',
    role: 'superadmin',
    businessId: null,
    assignedBranches: [branchId],
    staffId: null,
    name: 'Demo Admin',
    phone: '',
    approvalStatus: 'approved',
  },
  {
    uid: users.owner.uid,
    email: 'chutiem@gmail.com',
    role: 'owner',
    businessId,
    assignedBranches: [branchId],
    staffId: null,
    name: 'Chủ Tiệm',
    phone: '',
    approvalStatus: 'approved',
  },
  {
    uid: mainUid,
    email: 'thochinh@gmail.com',
    role: 'staff',
    businessId,
    assignedBranches: [branchId],
    staffId: 'staff-main',
    name: 'Thợ Chính',
    phone: '',
    approvalStatus: 'approved',
  },
  {
    uid: assistantUid,
    email: 'thophu@gmail.com',
    role: 'staff',
    businessId,
    assignedBranches: [branchId],
    staffId: 'staff-assistant',
    name: 'Thợ Phụ',
    phone: '',
    approvalStatus: 'approved',
  },
];

for (const profile of bookingProfiles) {
  await writeDocument(
    bookingDatabaseId,
    `users/${profile.uid}`,
    { ...profile, createdAt: nowIso, updatedAt: nowIso },
  );
}

await writeDocument(
  bookingDatabaseId,
  `businesses/${businessId}`,
  {
    id: businessId,
    ownerUid: users.owner.uid,
    companyName: 'Timmo Nails Berlin',
    status: 'active',
    subscriptionPlan: 'enterprise',
    createdAt: nowIso,
    updatedAt: nowIso,
  },
);

await writeDocument(
  bookingDatabaseId,
  `branches/${branchId}`,
  {
    ...demoBranch,
    id: branchId,
    businessId,
    slug: branchId,
    name: 'Timmo Nails Berlin',
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
);

const staffDefinitions = [
  {
    id: 'staff-main',
    userUid: mainUid,
    name: 'Thợ Chính',
    initials: 'TC',
    staffType: 'main',
    displayOrder: 1,
  },
  {
    id: 'staff-assistant',
    userUid: assistantUid,
    name: 'Thợ Phụ',
    initials: 'TP',
    staffType: 'junior',
    displayOrder: 2,
  },
];

for (const staff of staffDefinitions) {
  await writeDocument(
    bookingDatabaseId,
    `branches/${branchId}/staff/${staff.id}`,
    {
      ...staff,
      branchId,
      businessId,
      role: 'staff',
      serviceIds: demoServices
        .filter((service) =>
          staff.staffType === 'main'
            ? service.type === 'standard'
            : ['cat-mani', 'cat-pedi', 'cat-abloesung'].includes(service.categoryId),
        )
        .map((service) => service.id),
      status: 'active',
      hasAppointments: false,
      rating: 5,
      languages: ['DE', 'VI'],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  );
}

for (const category of demoCategories) {
  await writeDocument(
    bookingDatabaseId,
    `branches/${branchId}/categories/${category.id}`,
    { ...category, branchId, businessId },
  );
}

for (const service of demoServices) {
  await writeDocument(
    bookingDatabaseId,
    `branches/${branchId}/services/${service.id}`,
    { ...service, branchId, businessId },
  );
}

console.log(JSON.stringify({
  projectId,
  bookingDatabaseId,
  hrmDatabaseId,
  branchId,
  accounts: accountDefinitions.map((definition) => ({
    email: definition.email,
    uid: users[definition.key].uid,
  })),
}));

await deleteApp(app);
