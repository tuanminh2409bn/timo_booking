const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

let app;
const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
  console.log('🔑 Using serviceAccountKey.json for authentication...');
  const serviceAccount = require(serviceAccountPath);
  app = initializeApp({
    credential: cert(serviceAccount)
  });
} else {
  console.log('☁️ Using Application Default Credentials (ADC)...');
  console.log('   (Make sure you have run: gcloud auth application-default login)');
  app = initializeApp({ projectId: 'timmo-booking' });
}
const db = getFirestore();

const BRANCH_ID = 'timo-nail-berlin';
const BUSINESS_ID = 'biz-1781072640036';
const NOW = new Date().toISOString();

// ═══════════════════════════════════════
// 10 CATEGORIES
// ═══════════════════════════════════════
const categories = [
  { id: 'cat-gel', name: 'Neumodellage mit Gel', description: 'Gel-Neumodellage für natürliche und kreative Nägel', displayOrder: 1, conflictGroup: 'gel' },
  { id: 'cat-auffuellen-gel', name: 'Auffüllen mit Gel', description: 'Gel-Auffüllung für bestehende Gel-Nägel', displayOrder: 2, conflictGroup: 'gel' },
  { id: 'cat-acryl', name: 'Neumodellage mit Acryl', description: 'Acryl-Neumodellage für haltbare Nagelverstärkung', displayOrder: 3, conflictGroup: 'acryl' },
  { id: 'cat-auffuellen-acryl', name: 'Auffüllen mit Acryl', description: 'Acryl-Auffüllung für bestehende Acryl-Nägel', displayOrder: 4, conflictGroup: 'acryl' },
  { id: 'cat-zehen', name: 'Zehenmodellage', description: 'Zehennagelmodellage mit Gel oder Acryl', displayOrder: 5, requiresStaffAutoAssign: true },
  { id: 'cat-mani', name: 'Maniküre', description: 'Handpflege, Nagellack und Shellac', displayOrder: 6 },
  { id: 'cat-pedi', name: 'Pediküre', description: 'Fußpflege, Nagellack und Shellac', displayOrder: 7, requiresStaffAutoAssign: true },
  { id: 'cat-wimpern', name: 'Wimpern', description: 'Wimpernverlängerung, Auffüllung und Ablösung', displayOrder: 8 },
  { id: 'cat-abloesung', name: 'Ablösung', description: 'Professionelle Nagelablösung', displayOrder: 9 },
  { id: 'cat-zusatz', name: 'Zusatzleistungen', description: 'Individuelle Zusatzangebote', displayOrder: 10 },
];

// ═══════════════════════════════════════
// 35 SERVICES
// ═══════════════════════════════════════
const services = [
  // Neumodellage mit Gel (4)
  { id: 'svc-gel-natur', categoryId: 'cat-gel', name: 'Natur', description: 'Natürliche Gel-Neumodellage ohne Farbe', durationMinutes: 45, price: 40, conflictGroup: 'gel' },
  { id: 'svc-gel-farbe', categoryId: 'cat-gel', name: 'Farbe / Glitzer / French', description: 'Gel-Neumodellage mit Farbe, Glitzer oder French-Design', durationMinutes: 45, price: 48, conflictGroup: 'gel' },
  { id: 'svc-gel-babyboomer', categoryId: 'cat-gel', name: 'Verlauf (Babyboomer)', description: 'Gel-Neumodellage mit elegantem Babyboomer-Verlauf', durationMinutes: 45, price: 52, conflictGroup: 'gel' },
  { id: 'svc-gel-design', categoryId: 'cat-gel', name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Gel-Neumodellage', durationMinutes: 15, price: 10, isAddon: true, conflictGroup: 'gel' },

  // Auffüllen mit Gel (4)
  { id: 'svc-auffgel-natur', categoryId: 'cat-auffuellen-gel', name: 'Natur', description: 'Gel-Auffüllung ohne Farbe', durationMinutes: 45, price: 35, conflictGroup: 'gel' },
  { id: 'svc-auffgel-farbe', categoryId: 'cat-auffuellen-gel', name: 'Farbe / Glitzer / French', description: 'Gel-Auffüllung mit Farbe, Glitzer oder French-Design', durationMinutes: 45, price: 43, conflictGroup: 'gel' },
  { id: 'svc-auffgel-babyboomer', categoryId: 'cat-auffuellen-gel', name: 'Verlauf (Babyboomer)', description: 'Gel-Auffüllung mit elegantem Babyboomer-Verlauf', durationMinutes: 45, price: 47, conflictGroup: 'gel' },
  { id: 'svc-auffgel-design', categoryId: 'cat-auffuellen-gel', name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Gel-Auffüllung', durationMinutes: 15, price: 10, isAddon: true, conflictGroup: 'gel' },

  // Neumodellage mit Acryl (4)
  { id: 'svc-acryl-natur', categoryId: 'cat-acryl', name: 'Natur', description: 'Natürliche Acryl-Neumodellage ohne Farbe', durationMinutes: 45, price: 38, conflictGroup: 'acryl' },
  { id: 'svc-acryl-farbe', categoryId: 'cat-acryl', name: 'Farbe / Glitzer / French', description: 'Acryl-Neumodellage mit Farbe, Glitzer oder French-Design', durationMinutes: 45, price: 45, conflictGroup: 'acryl' },
  { id: 'svc-acryl-babyboomer', categoryId: 'cat-acryl', name: 'Verlauf (Babyboomer)', description: 'Acryl-Neumodellage mit elegantem Babyboomer-Verlauf', durationMinutes: 45, price: 48, conflictGroup: 'acryl' },
  { id: 'svc-acryl-design', categoryId: 'cat-acryl', name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Acryl-Neumodellage', durationMinutes: 15, price: 10, isAddon: true, conflictGroup: 'acryl' },

  // Auffüllen mit Acryl (4)
  { id: 'svc-auffacryl-natur', categoryId: 'cat-auffuellen-acryl', name: 'Natur', description: 'Acryl-Auffüllung ohne Farbe', durationMinutes: 45, price: 33, conflictGroup: 'acryl' },
  { id: 'svc-auffacryl-farbe', categoryId: 'cat-auffuellen-acryl', name: 'Farbe / Glitzer / French', description: 'Acryl-Auffüllung mit Farbe, Glitzer oder French-Design', durationMinutes: 45, price: 40, conflictGroup: 'acryl' },
  { id: 'svc-auffacryl-babyboomer', categoryId: 'cat-auffuellen-acryl', name: 'Verlauf (Babyboomer)', description: 'Acryl-Auffüllung mit elegantem Babyboomer-Verlauf', durationMinutes: 45, price: 43, conflictGroup: 'acryl' },
  { id: 'svc-auffacryl-design', categoryId: 'cat-auffuellen-acryl', name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Acryl-Auffüllung', durationMinutes: 15, price: 10, isAddon: true, conflictGroup: 'acryl' },

  // Zehenmodellage (3)
  { id: 'svc-zehen-gel', categoryId: 'cat-zehen', name: 'Mit Gel', description: 'Zehennagelmodellage mit Gel', durationMinutes: 45, price: 42 },
  { id: 'svc-zehen-acryl', categoryId: 'cat-zehen', name: 'Mit Acryl', description: 'Zehennagelmodellage mit Acryl', durationMinutes: 45, price: 42 },
  { id: 'svc-zehen-design', categoryId: 'cat-zehen', name: 'Design / Extra', description: 'Zusätzliches Design zur Zehenmodellage', durationMinutes: 15, price: 10, isAddon: true },

  // Maniküre (4)
  { id: 'svc-mani-basic', categoryId: 'cat-mani', name: 'Basic', description: 'Grundlegende Maniküre mit Feilen und Nagelpflege', durationMinutes: 15, price: 15 },
  { id: 'svc-mani-lack', categoryId: 'cat-mani', name: 'Mit Nagellack', description: 'Maniküre mit klassischem Nagellack', durationMinutes: 30, price: 25 },
  { id: 'svc-mani-shellac', categoryId: 'cat-mani', name: 'Mit Shellac', description: 'Maniküre mit langhaltendem Shellac-Lack', durationMinutes: 45, price: 35 },
  { id: 'svc-mani-design', categoryId: 'cat-mani', name: 'Design / Extra', description: 'Zusätzliches Design zur Maniküre', durationMinutes: 15, price: 10, isAddon: true },

  // Pediküre (4)
  { id: 'svc-pedi-basic', categoryId: 'cat-pedi', name: 'Basic', description: 'Grundlegende Pediküre mit Fußpflege', durationMinutes: 45, price: 28 },
  { id: 'svc-pedi-lack', categoryId: 'cat-pedi', name: 'Mit Nagellack', description: 'Pediküre mit klassischem Nagellack', durationMinutes: 45, price: 35 },
  { id: 'svc-pedi-shellac', categoryId: 'cat-pedi', name: 'Mit Shellac', description: 'Pediküre mit langhaltendem Shellac-Lack', durationMinutes: 45, price: 42 },
  { id: 'svc-pedi-design', categoryId: 'cat-pedi', name: 'Design / Extra', description: 'Zusätzliches Design zur Pediküre', durationMinutes: 15, price: 10, isAddon: true },

  // Wimpern (3)
  { id: 'svc-wimpern-verl', categoryId: 'cat-wimpern', name: 'Wimpernverlängerung', description: 'Professionelle Wimpernverlängerung', durationMinutes: 60, price: 70 },
  { id: 'svc-wimpern-fuell', categoryId: 'cat-wimpern', name: 'Wimpernfüllung', description: 'Auffüllung bestehender Wimpernverlängerung', durationMinutes: 45, price: 45 },
  { id: 'svc-wimpern-abloesung', categoryId: 'cat-wimpern', name: 'Wimpernablösung', description: 'Schonende Entfernung der Wimpernverlängerung', durationMinutes: 30, price: 15 },

  // Ablösung (1)
  { id: 'svc-abloesung', categoryId: 'cat-abloesung', name: 'Ablösung', description: 'Professionelle Ablösung von Gel- oder Acrylnägeln', durationMinutes: 15, price: 12 },

  // Zusatzleistungen (8)
  { id: 'svc-zusatz-massage-30', categoryId: 'cat-zusatz', name: 'Massage 30 Min', description: 'Entspannende Hand- oder Fußmassage (30 Minuten)', durationMinutes: 30, price: 25, type: 'addon' },
  { id: 'svc-zusatz-massage-45', categoryId: 'cat-zusatz', name: 'Massage 45 Min', description: 'Entspannende Hand- oder Fußmassage (45 Minuten)', durationMinutes: 45, price: 35, type: 'addon' },
  { id: 'svc-zusatz-massage-60', categoryId: 'cat-zusatz', name: 'Massage 60 Min', description: 'Entspannende Hand- oder Fußmassage (60 Minuten)', durationMinutes: 60, price: 45, type: 'addon' },
  { id: 'svc-zusatz-headspa-30', categoryId: 'cat-zusatz', name: 'Head Spa 30 Min', description: 'Entspannendes Head Spa für Kopfhaut und Haare (30 Minuten)', durationMinutes: 30, price: 30, type: 'addon' },
  { id: 'svc-zusatz-headspa-45', categoryId: 'cat-zusatz', name: 'Head Spa 45 Min', description: 'Entspannendes Head Spa für Kopfhaut und Haare (45 Minuten)', durationMinutes: 45, price: 40, type: 'addon' },
  { id: 'svc-zusatz-headspa-60', categoryId: 'cat-zusatz', name: 'Head Spa 60 Min', description: 'Entspannendes Head Spa für Kopfhaut und Haare (60 Minuten)', durationMinutes: 60, price: 55, type: 'addon' },
  { id: 'svc-zusatz-deluxe-mani', categoryId: 'cat-zusatz', name: 'Deluxe Maniküre', description: 'Premium-Handpflege mit Peeling, Maske und Massage', durationMinutes: 60, price: 55, type: 'addon' },
  { id: 'svc-zusatz-deluxe-pedi', categoryId: 'cat-zusatz', name: 'Deluxe Pediküre', description: 'Premium-Fußpflege mit Peeling, Maske und Massage', durationMinutes: 75, price: 65, type: 'addon' },
];

async function main() {
  console.log(`\n🔧 Seeding services for branch: ${BRANCH_ID}\n`);

  // Step 1: Delete existing categories
  console.log('🗑️  Deleting existing categories...');
  const catSnap = await db.collection(`branches/${BRANCH_ID}/categories`).get();
  const catBatch = db.batch();
  catSnap.docs.forEach(doc => catBatch.delete(doc.ref));
  if (!catSnap.empty) {
    await catBatch.commit();
    console.log(`   Deleted ${catSnap.size} categories`);
  } else {
    console.log('   No existing categories to delete');
  }

  // Step 2: Delete existing services
  console.log('🗑️  Deleting existing services...');
  const svcSnap = await db.collection(`branches/${BRANCH_ID}/services`).get();
  const svcBatch = db.batch();
  svcSnap.docs.forEach(doc => svcBatch.delete(doc.ref));
  if (!svcSnap.empty) {
    await svcBatch.commit();
    console.log(`   Deleted ${svcSnap.size} services`);
  } else {
    console.log('   No existing services to delete');
  }

  // Step 3: Create categories (batch write, max 500 per batch)
  console.log('\n📂 Creating 10 categories...');
  const catWriteBatch = db.batch();
  for (const cat of categories) {
    const ref = db.doc(`branches/${BRANCH_ID}/categories/${cat.id}`);
    catWriteBatch.set(ref, {
      ...cat,
      branchId: BRANCH_ID,
      businessId: BUSINESS_ID,
      isActive: true,
    });
  }
  await catWriteBatch.commit();
  console.log('   ✅ 10 categories created');

  // Step 4: Create services (batch write)
  console.log('💅 Creating 35 services...');
  const svcWriteBatch = db.batch();
  let displayOrder = 0;
  let lastCat = '';
  for (const svc of services) {
    if (svc.categoryId !== lastCat) {
      displayOrder = 0;
      lastCat = svc.categoryId;
    }
    displayOrder++;

    const ref = db.doc(`branches/${BRANCH_ID}/services/${svc.id}`);
    svcWriteBatch.set(ref, {
      id: svc.id,
      branchId: BRANCH_ID,
      businessId: BUSINESS_ID,
      categoryId: svc.categoryId,
      name: svc.name,
      description: svc.description,
      durationMinutes: svc.durationMinutes,
      price: svc.price,
      currency: '€',
      displayOrder,
      isActive: true,
      hasAppointments: false,
      type: svc.type || 'standard',
      isAddon: svc.isAddon || false,
      conflictGroup: svc.conflictGroup || null,
      createdAt: NOW,
    });
  }
  await svcWriteBatch.commit();
  console.log('   ✅ 35 services created');

  console.log('\n🎉 Done! All services seeded for timo-nail-berlin\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
