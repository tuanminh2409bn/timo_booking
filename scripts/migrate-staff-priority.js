// Migration script: Update staffPriority for all services in a branch
// Usage: node scripts/migrate-staff-priority.js <branchSlug>

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('../serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

// Staff priority mapping by service ID
const STAFF_PRIORITY_MAP = {
  // assistant_staff — thợ phụ ưu tiên nhất
  'svc-abloesung': 'assistant_staff',
  'svc-mani-basic': 'assistant_staff',
  'svc-mani-lack': 'assistant_staff',
  'svc-pedi-basic': 'assistant_staff',
  'svc-pedi-lack': 'assistant_staff',
  'svc-zusatz-massage-30': 'assistant_staff',
  'svc-zusatz-massage-45': 'assistant_staff',
  'svc-zusatz-massage-60': 'assistant_staff',
  'svc-zusatz-headspa-30': 'assistant_staff',
  'svc-zusatz-headspa-45': 'assistant_staff',
  'svc-zusatz-headspa-60': 'assistant_staff',

  // conditional_assistant — có thể cho thợ phụ nếu quen tay
  'svc-wimpern-abloesung': 'conditional_assistant',
  'svc-pedi-shellac': 'conditional_assistant',
  'svc-mani-shellac': 'conditional_assistant',

  // main_staff — chỉ thợ chính
  'svc-gel-natur': 'main_staff',
  'svc-gel-farbe': 'main_staff',
  'svc-gel-babyboomer': 'main_staff',
  'svc-gel-design': 'main_staff',
  'svc-auffgel-natur': 'main_staff',
  'svc-auffgel-farbe': 'main_staff',
  'svc-auffgel-babyboomer': 'main_staff',
  'svc-auffgel-design': 'main_staff',
  'svc-acryl-natur': 'main_staff',
  'svc-acryl-farbe': 'main_staff',
  'svc-acryl-babyboomer': 'main_staff',
  'svc-acryl-design': 'main_staff',
  'svc-auffacryl-natur': 'main_staff',
  'svc-auffacryl-farbe': 'main_staff',
  'svc-auffacryl-babyboomer': 'main_staff',
  'svc-auffacryl-design': 'main_staff',
  'svc-zehen-gel': 'main_staff',
  'svc-zehen-acryl': 'main_staff',
  'svc-zehen-design': 'main_staff',
  'svc-wimpern-verl': 'main_staff',
  'svc-wimpern-fuell': 'main_staff',

  // none — default
  'svc-mani-design': 'none',
  'svc-pedi-design': 'none',
  'svc-zusatz-deluxe-mani': 'none',
  'svc-zusatz-deluxe-pedi': 'none',
};

async function migrate(branchSlug) {
  console.log(`\n🔄 Migrating staffPriority for branch: ${branchSlug}\n`);
  
  const servicesRef = db.collection('branches').doc(branchSlug).collection('services');
  const snapshot = await servicesRef.get();
  
  if (snapshot.empty) {
    console.log('❌ No services found in this branch.');
    return;
  }

  const batch = db.batch();
  let updated = 0;
  let skipped = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    const serviceId = data.id || doc.id;
    const newPriority = STAFF_PRIORITY_MAP[serviceId];

    if (newPriority) {
      const currentPriority = data.staffPriority;
      if (currentPriority !== newPriority) {
        batch.update(doc.ref, { staffPriority: newPriority });
        console.log(`  ✅ ${serviceId} (${data.name}): ${currentPriority || 'undefined'} → ${newPriority}`);
        updated++;
      } else {
        console.log(`  ⏭️  ${serviceId} (${data.name}): already ${currentPriority}`);
        skipped++;
      }
    } else {
      // Service not in our map — set to 'none' if not already set
      if (!data.staffPriority) {
        batch.update(doc.ref, { staffPriority: 'none' });
        console.log(`  ⚪ ${serviceId} (${data.name}): undefined → none (default)`);
        updated++;
      } else {
        console.log(`  ⏭️  ${serviceId} (${data.name}): already ${data.staffPriority}`);
        skipped++;
      }
    }
  });

  if (updated > 0) {
    await batch.commit();
    console.log(`\n✅ Done! Updated ${updated} services, skipped ${skipped}.`);
  } else {
    console.log(`\n✅ All services already have correct staffPriority. Nothing to update.`);
  }
}

// Get branch slug from CLI args
const branchSlug = process.argv[2];
if (!branchSlug) {
  console.log('Usage: node scripts/migrate-staff-priority.js <branchSlug>');
  console.log('Example: node scripts/migrate-staff-priority.js timo-nail-berlin');
  process.exit(1);
}

migrate(branchSlug)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
