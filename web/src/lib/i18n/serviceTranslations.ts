'use client';

import { useI18n, Locale } from './index';

// ═══════════════════════════════════════════════════
//  Multilingual service & category translations
//  Keyed by ID for fast lookup
// ═══════════════════════════════════════════════════

type TranslatedItem = { name: string; description: string };

export const categoryTranslations: Record<Locale, Record<string, TranslatedItem>> = {
  de: {
    'cat-gel': { name: 'Neumodellage mit Gel', description: 'Gel-Neumodellage für natürliche und kreative Nägel' },
    'cat-acryl': { name: 'Neumodellage mit Acryl', description: 'Acryl-Neumodellage für haltbare Nagelverstärkung' },
    'cat-auffuellen-gel': { name: 'Auffüllen mit Gel', description: 'Gel-Auffüllung für bestehende Modellage' },
    'cat-auffuellen-acryl': { name: 'Auffüllen mit Acryl', description: 'Acryl-Auffüllung für bestehende Modellage' },
    'cat-zehen': { name: 'Zehenmodellage', description: 'Zehennagelmodellage mit Gel oder Acryl' },
    'cat-mani': { name: 'Maniküre', description: 'Handpflege, Nagellack und Shellac' },
    'cat-pedi': { name: 'Pediküre', description: 'Fußpflege, Nagellack und Shellac' },
    'cat-wimpern': { name: 'Wimpern', description: 'Wimpernverlängerung, Auffüllung und Ablösung' },
    'cat-abloesung': { name: 'Ablösung', description: 'Professionelle Nagelablösung' },
    'cat-zusatz': { name: 'Zusatzleistungen', description: 'Individuelle Zusatzangebote' },
  },
  en: {
    'cat-gel': { name: 'Gel Nail Extensions', description: 'New gel nail extensions for natural and creative nails' },
    'cat-acryl': { name: 'Acrylic Nail Extensions', description: 'Acrylic nail extensions for durable reinforcement' },
    'cat-auffuellen-gel': { name: 'Gel Refill', description: 'Gel refill for existing nail extensions' },
    'cat-auffuellen-acryl': { name: 'Acrylic Refill', description: 'Acrylic refill for existing nail extensions' },
    'cat-zehen': { name: 'Toe Nail Extensions', description: 'Toe nail modelling with gel or acrylic' },
    'cat-mani': { name: 'Manicure', description: 'Hand care, nail polish and shellac' },
    'cat-pedi': { name: 'Pedicure', description: 'Foot care, nail polish and shellac' },
    'cat-wimpern': { name: 'Eyelashes', description: 'Eyelash extensions, refills and removal' },
    'cat-abloesung': { name: 'Removal', description: 'Professional nail removal' },
    'cat-zusatz': { name: 'Additional Services', description: 'Individual add-on services' },
  },
  vi: {
    'cat-gel': { name: 'Đắp Gel mới', description: 'Đắp móng Gel cho móng tự nhiên và sáng tạo' },
    'cat-acryl': { name: 'Đắp Acrylic mới', description: 'Đắp móng Acrylic bền chắc' },
    'cat-auffuellen-gel': { name: 'Đắp bù Gel', description: 'Đắp bù Gel cho móng đã có sẵn' },
    'cat-auffuellen-acryl': { name: 'Đắp bù Acrylic', description: 'Đắp bù Acrylic cho móng đã có sẵn' },
    'cat-zehen': { name: 'Đắp móng chân', description: 'Đắp móng chân bằng Gel hoặc Acrylic' },
    'cat-mani': { name: 'Chăm sóc tay', description: 'Chăm sóc tay, sơn móng và Shellac' },
    'cat-pedi': { name: 'Chăm sóc chân', description: 'Chăm sóc chân, sơn móng và Shellac' },
    'cat-wimpern': { name: 'Lông mi', description: 'Nối mi, bổ sung và tháo mi' },
    'cat-abloesung': { name: 'Tháo móng', description: 'Tháo móng chuyên nghiệp' },
    'cat-zusatz': { name: 'Dịch vụ bổ sung', description: 'Dịch vụ bổ sung tùy chỉnh' },
  },
};

export const serviceTranslations: Record<Locale, Record<string, TranslatedItem>> = {
  de: {
    // Gel
    'svc-gel-natur': { name: 'Natur', description: 'Natürliche Gel-Neumodellage ohne Farbe' },
    'svc-gel-farbe': { name: 'Farbe / Glitzer / French', description: 'Gel-Neumodellage mit Farbe, Glitzer oder French-Design' },
    'svc-gel-babyboomer': { name: 'Verlauf (Babyboomer)', description: 'Gel-Neumodellage mit elegantem Babyboomer-Verlauf' },
    'svc-gel-design': { name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Gel-Neumodellage' },
    // Acryl
    'svc-acryl-natur': { name: 'Natur', description: 'Natürliche Acryl-Neumodellage ohne Farbe' },
    'svc-acryl-farbe': { name: 'Farbe / Glitzer / French', description: 'Acryl-Neumodellage mit Farbe, Glitzer oder French-Design' },
    'svc-acryl-babyboomer': { name: 'Verlauf (Babyboomer)', description: 'Acryl-Neumodellage mit elegantem Babyboomer-Verlauf' },
    'svc-acryl-design': { name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Acryl-Neumodellage' },
    // Auffüllen Gel
    'svc-auffgel-natur': { name: 'Natur', description: 'Natürliche Gel-Auffüllung ohne Farbe' },
    'svc-auffgel-farbe': { name: 'Farbe / Glitzer / French', description: 'Gel-Auffüllung mit Farbe, Glitzer oder French-Design' },
    'svc-auffgel-babyboomer': { name: 'Verlauf (Babyboomer)', description: 'Gel-Auffüllung mit elegantem Babyboomer-Verlauf' },
    'svc-auffgel-design': { name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Gel-Auffüllung' },
    // Auffüllen Acryl
    'svc-auffacryl-natur': { name: 'Natur', description: 'Natürliche Acryl-Auffüllung ohne Farbe' },
    'svc-auffacryl-farbe': { name: 'Farbe / Glitzer / French', description: 'Acryl-Auffüllung mit Farbe, Glitzer oder French-Design' },
    'svc-auffacryl-babyboomer': { name: 'Verlauf (Babyboomer)', description: 'Acryl-Auffüllung mit elegantem Babyboomer-Verlauf' },
    'svc-auffacryl-design': { name: 'Design / Extra', description: 'Zusätzliches Nageldesign zur Acryl-Auffüllung' },
    // Zehen
    'svc-zehen-gel': { name: 'Mit Gel', description: 'Zehennagelmodellage mit Gel' },
    'svc-zehen-acryl': { name: 'Mit Acryl', description: 'Zehennagelmodellage mit Acryl' },
    'svc-zehen-design': { name: 'Design / Extra', description: 'Zusätzliches Design zur Zehenmodellage' },
    // Maniküre
    'svc-mani-basic': { name: 'Basic', description: 'Grundlegende Maniküre mit Feilen und Nagelpflege' },
    'svc-mani-lack': { name: 'Mit Nagellack', description: 'Maniküre mit klassischem Nagellack' },
    'svc-mani-shellac': { name: 'Mit Shellac', description: 'Maniküre mit langhaltendem Shellac-Lack' },
    'svc-mani-design': { name: 'Design / Extra', description: 'Zusätzliches Design zur Maniküre' },
    // Pediküre
    'svc-pedi-basic': { name: 'Basic', description: 'Grundlegende Pediküre mit Fußpflege' },
    'svc-pedi-lack': { name: 'Mit Nagellack', description: 'Pediküre mit klassischem Nagellack' },
    'svc-pedi-shellac': { name: 'Mit Shellac', description: 'Pediküre mit langhaltendem Shellac-Lack' },
    'svc-pedi-design': { name: 'Design / Extra', description: 'Zusätzliches Design zur Pediküre' },
    // Wimpern
    'svc-wimpern-verl': { name: 'Wimpernverlängerung', description: 'Professionelle Wimpernverlängerung' },
    'svc-wimpern-fuell': { name: 'Wimpernfüllung', description: 'Auffüllung bestehender Wimpernverlängerung' },
    'svc-wimpern-abloesung': { name: 'Wimpernablösung', description: 'Schonende Entfernung der Wimpernverlängerung' },
    // Ablösung
    'svc-abloesung': { name: 'Ablösung', description: 'Professionelle Ablösung von Gel- oder Acrylnägeln' },
    // Zusatz
    'svc-zusatz-deluxe-mani': { name: 'Deluxe Maniküre', description: 'Premium-Handpflege mit Peeling, Maske und Massage' },
    'svc-zusatz-deluxe-pedi': { name: 'Deluxe Pediküre', description: 'Premium-Fußpflege mit Peeling, Maske und Massage' },
    'svc-zusatz-massage-30': { name: 'Massage 30 Min', description: 'Entspannende Hand- oder Fußmassage (30 Minuten)' },
    'svc-zusatz-massage-45': { name: 'Massage 45 Min', description: 'Entspannende Hand- oder Fußmassage (45 Minuten)' },
    'svc-zusatz-massage-60': { name: 'Massage 60 Min', description: 'Entspannende Hand- oder Fußmassage (60 Minuten)' },
    'svc-zusatz-headspa-30': { name: 'Head Spa 30 Min', description: 'Entspannendes Head Spa (30 Minuten)' },
    'svc-zusatz-headspa-45': { name: 'Head Spa 45 Min', description: 'Entspannendes Head Spa (45 Minuten)' },
    'svc-zusatz-headspa-60': { name: 'Head Spa 60 Min', description: 'Entspannendes Head Spa (60 Minuten)' },
  },
  en: {
    // Gel
    'svc-gel-natur': { name: 'Natural', description: 'Natural gel nail extension without colour' },
    'svc-gel-farbe': { name: 'Colour / Glitter / French', description: 'Gel extension with colour, glitter or French design' },
    'svc-gel-babyboomer': { name: 'Gradient (Babyboomer)', description: 'Gel extension with elegant Babyboomer gradient' },
    'svc-gel-design': { name: 'Design / Extra', description: 'Additional nail design for gel extension' },
    // Acryl
    'svc-acryl-natur': { name: 'Natural', description: 'Natural acrylic nail extension without colour' },
    'svc-acryl-farbe': { name: 'Colour / Glitter / French', description: 'Acrylic extension with colour, glitter or French design' },
    'svc-acryl-babyboomer': { name: 'Gradient (Babyboomer)', description: 'Acrylic extension with elegant Babyboomer gradient' },
    'svc-acryl-design': { name: 'Design / Extra', description: 'Additional nail design for acrylic extension' },
    // Auffüllen Gel
    'svc-auffgel-natur': { name: 'Natural', description: 'Natural gel refill without colour' },
    'svc-auffgel-farbe': { name: 'Colour / Glitter / French', description: 'Gel refill with colour, glitter or French design' },
    'svc-auffgel-babyboomer': { name: 'Gradient (Babyboomer)', description: 'Gel refill with elegant Babyboomer gradient' },
    'svc-auffgel-design': { name: 'Design / Extra', description: 'Additional nail design for gel refill' },
    // Auffüllen Acryl
    'svc-auffacryl-natur': { name: 'Natural', description: 'Natural acrylic refill without colour' },
    'svc-auffacryl-farbe': { name: 'Colour / Glitter / French', description: 'Acrylic refill with colour, glitter or French design' },
    'svc-auffacryl-babyboomer': { name: 'Gradient (Babyboomer)', description: 'Acrylic refill with elegant Babyboomer gradient' },
    'svc-auffacryl-design': { name: 'Design / Extra', description: 'Additional nail design for acrylic refill' },
    // Zehen
    'svc-zehen-gel': { name: 'With Gel', description: 'Toe nail modelling with gel' },
    'svc-zehen-acryl': { name: 'With Acrylic', description: 'Toe nail modelling with acrylic' },
    'svc-zehen-design': { name: 'Design / Extra', description: 'Additional design for toe nail modelling' },
    // Manicure
    'svc-mani-basic': { name: 'Basic', description: 'Basic manicure with filing and nail care' },
    'svc-mani-lack': { name: 'With Nail Polish', description: 'Manicure with classic nail polish' },
    'svc-mani-shellac': { name: 'With Shellac', description: 'Manicure with long-lasting Shellac polish' },
    'svc-mani-design': { name: 'Design / Extra', description: 'Additional design for manicure' },
    // Pedicure
    'svc-pedi-basic': { name: 'Basic', description: 'Basic pedicure with foot care' },
    'svc-pedi-lack': { name: 'With Nail Polish', description: 'Pedicure with classic nail polish' },
    'svc-pedi-shellac': { name: 'With Shellac', description: 'Pedicure with long-lasting Shellac polish' },
    'svc-pedi-design': { name: 'Design / Extra', description: 'Additional design for pedicure' },
    // Eyelashes
    'svc-wimpern-verl': { name: 'Eyelash Extensions', description: 'Professional eyelash extensions' },
    'svc-wimpern-fuell': { name: 'Eyelash Refill', description: 'Refill of existing eyelash extensions' },
    'svc-wimpern-abloesung': { name: 'Eyelash Removal', description: 'Gentle removal of eyelash extensions' },
    // Removal
    'svc-abloesung': { name: 'Removal', description: 'Professional removal of gel or acrylic nails' },
    // Additional
    'svc-zusatz-deluxe-mani': { name: 'Deluxe Manicure', description: 'Premium hand care with exfoliation, mask and massage' },
    'svc-zusatz-deluxe-pedi': { name: 'Deluxe Pedicure', description: 'Premium foot care with exfoliation, mask and massage' },
    'svc-zusatz-massage-30': { name: 'Massage 30 Min', description: 'Relaxing hand or foot massage (30 minutes)' },
    'svc-zusatz-massage-45': { name: 'Massage 45 Min', description: 'Relaxing hand or foot massage (45 minutes)' },
    'svc-zusatz-massage-60': { name: 'Massage 60 Min', description: 'Relaxing hand or foot massage (60 minutes)' },
    'svc-zusatz-headspa-30': { name: 'Head Spa 30 Min', description: 'Relaxing head spa (30 minutes)' },
    'svc-zusatz-headspa-45': { name: 'Head Spa 45 Min', description: 'Relaxing head spa (45 minutes)' },
    'svc-zusatz-headspa-60': { name: 'Head Spa 60 Min', description: 'Relaxing head spa (60 minutes)' },
  },
  vi: {
    // Gel
    'svc-gel-natur': { name: 'Tự nhiên', description: 'Đắp Gel tự nhiên không màu' },
    'svc-gel-farbe': { name: 'Màu / Nhũ / French', description: 'Đắp Gel với màu, nhũ hoặc kiểu French' },
    'svc-gel-babyboomer': { name: 'Ombre (Babyboomer)', description: 'Đắp Gel với hiệu ứng Babyboomer ombre' },
    'svc-gel-design': { name: 'Thiết kế / Phụ thêm', description: 'Thiết kế nail bổ sung cho đắp Gel' },
    // Acryl
    'svc-acryl-natur': { name: 'Tự nhiên', description: 'Đắp Acrylic tự nhiên không màu' },
    'svc-acryl-farbe': { name: 'Màu / Nhũ / French', description: 'Đắp Acrylic với màu, nhũ hoặc kiểu French' },
    'svc-acryl-babyboomer': { name: 'Ombre (Babyboomer)', description: 'Đắp Acrylic với hiệu ứng Babyboomer ombre' },
    'svc-acryl-design': { name: 'Thiết kế / Phụ thêm', description: 'Thiết kế nail bổ sung cho đắp Acrylic' },
    // Auffüllen Gel
    'svc-auffgel-natur': { name: 'Tự nhiên', description: 'Đắp bù Gel tự nhiên không màu' },
    'svc-auffgel-farbe': { name: 'Màu / Nhũ / French', description: 'Đắp bù Gel với màu, nhũ hoặc kiểu French' },
    'svc-auffgel-babyboomer': { name: 'Ombre (Babyboomer)', description: 'Đắp bù Gel với hiệu ứng Babyboomer ombre' },
    'svc-auffgel-design': { name: 'Thiết kế / Phụ thêm', description: 'Thiết kế nail bổ sung cho đắp bù Gel' },
    // Auffüllen Acryl
    'svc-auffacryl-natur': { name: 'Tự nhiên', description: 'Đắp bù Acrylic tự nhiên không màu' },
    'svc-auffacryl-farbe': { name: 'Màu / Nhũ / French', description: 'Đắp bù Acrylic với màu, nhũ hoặc kiểu French' },
    'svc-auffacryl-babyboomer': { name: 'Ombre (Babyboomer)', description: 'Đắp bù Acrylic với hiệu ứng Babyboomer ombre' },
    'svc-auffacryl-design': { name: 'Thiết kế / Phụ thêm', description: 'Thiết kế nail bổ sung cho đắp bù Acrylic' },
    // Zehen
    'svc-zehen-gel': { name: 'Gel', description: 'Đắp móng chân bằng Gel' },
    'svc-zehen-acryl': { name: 'Acrylic', description: 'Đắp móng chân bằng Acrylic' },
    'svc-zehen-design': { name: 'Thiết kế / Phụ thêm', description: 'Thiết kế bổ sung cho đắp móng chân' },
    // Maniküre
    'svc-mani-basic': { name: 'Cơ bản', description: 'Chăm sóc tay cơ bản với dũa và chăm sóc móng' },
    'svc-mani-lack': { name: 'Sơn thường', description: 'Chăm sóc tay kèm sơn móng thường' },
    'svc-mani-shellac': { name: 'Shellac', description: 'Chăm sóc tay kèm sơn Shellac bền lâu' },
    'svc-mani-design': { name: 'Thiết kế / Phụ thêm', description: 'Thiết kế bổ sung cho chăm sóc tay' },
    // Pediküre
    'svc-pedi-basic': { name: 'Cơ bản', description: 'Chăm sóc chân cơ bản' },
    'svc-pedi-lack': { name: 'Sơn thường', description: 'Chăm sóc chân kèm sơn móng thường' },
    'svc-pedi-shellac': { name: 'Shellac', description: 'Chăm sóc chân kèm sơn Shellac bền lâu' },
    'svc-pedi-design': { name: 'Thiết kế / Phụ thêm', description: 'Thiết kế bổ sung cho chăm sóc chân' },
    // Wimpern
    'svc-wimpern-verl': { name: 'Nối mi', description: 'Nối mi chuyên nghiệp' },
    'svc-wimpern-fuell': { name: 'Bổ sung mi', description: 'Bổ sung mi đã nối trước đó' },
    'svc-wimpern-abloesung': { name: 'Tháo mi', description: 'Tháo mi nhẹ nhàng' },
    // Ablösung
    'svc-abloesung': { name: 'Tháo móng', description: 'Tháo móng Gel hoặc Acrylic chuyên nghiệp' },
    // Zusatz
    'svc-zusatz-deluxe-mani': { name: 'Chăm sóc tay Deluxe', description: 'Chăm sóc tay cao cấp với tẩy da chết, mặt nạ và massage' },
    'svc-zusatz-deluxe-pedi': { name: 'Chăm sóc chân Deluxe', description: 'Chăm sóc chân cao cấp với tẩy da chết, mặt nạ và massage' },
    'svc-zusatz-massage-30': { name: 'Massage 30 phút', description: 'Massage thư giãn tay hoặc chân (30 phút)' },
    'svc-zusatz-massage-45': { name: 'Massage 45 phút', description: 'Massage thư giãn tay hoặc chân (45 phút)' },
    'svc-zusatz-massage-60': { name: 'Massage 60 phút', description: 'Massage thư giãn tay hoặc chân (60 phút)' },
    'svc-zusatz-headspa-30': { name: 'Head Spa 30 phút', description: 'Head Spa thư giãn (30 phút)' },
    'svc-zusatz-headspa-45': { name: 'Head Spa 45 phút', description: 'Head Spa thư giãn (45 phút)' },
    'svc-zusatz-headspa-60': { name: 'Head Spa 60 phút', description: 'Head Spa thư giãn (60 phút)' },
  },
};

/** Hook to get translated service/category names */
export function useServiceTranslation() {
  const { locale } = useI18n();

  return {
    /** Get translated category name */
    getCategoryName: (id: string, fallback: string) =>
      categoryTranslations[locale]?.[id]?.name ?? fallback,

    /** Get translated category description */
    getCategoryDescription: (id: string, fallback: string) =>
      categoryTranslations[locale]?.[id]?.description ?? fallback,

    /** Get translated service name */
    getServiceName: (id: string, fallback: string) =>
      serviceTranslations[locale]?.[id]?.name ?? fallback,

    /** Get translated service description */
    getServiceDescription: (id: string, fallback: string) =>
      serviceTranslations[locale]?.[id]?.description ?? fallback,
  };
}

/** Automatically translate/localize category or service name using translation dictionary */
export function autoLocalizeName(name: string): { vi: string; en: string; de: string } {
  const clean = name.trim();
  if (!clean) return { vi: '', en: '', de: '' };

  const lower = clean.toLowerCase();

  // 1. Check category translations (bidirectional matching)
  for (const catId of Object.keys(categoryTranslations.de)) {
    const deName = categoryTranslations.de[catId]?.name || '';
    const enName = categoryTranslations.en[catId]?.name || '';
    const viName = categoryTranslations.vi[catId]?.name || '';

    if (
      deName.toLowerCase() === lower ||
      enName.toLowerCase() === lower ||
      viName.toLowerCase() === lower
    ) {
      return { vi: viName, en: enName, de: deName };
    }
  }

  // 2. Check service translations (bidirectional matching)
  for (const svcId of Object.keys(serviceTranslations.de)) {
    const deName = serviceTranslations.de[svcId]?.name || '';
    const enName = serviceTranslations.en[svcId]?.name || '';
    const viName = serviceTranslations.vi[svcId]?.name || '';

    if (
      deName.toLowerCase() === lower ||
      enName.toLowerCase() === lower ||
      viName.toLowerCase() === lower
    ) {
      return { vi: viName, en: enName, de: deName };
    }
  }

  // 3. Custom glossary of common variations and fragments
  const glossary = [
    { de: 'Natur', en: 'Natural', vi: 'Tự nhiên' },
    { de: 'Gel', en: 'Gel', vi: 'Gel' },
    { de: 'Acryl', en: 'Acrylic', vi: 'Acrylic' },
    { de: 'Mit Gel', en: 'With Gel', vi: 'Gel' },
    { de: 'Mit Acryl', en: 'With Acrylic', vi: 'Acrylic' },
    { de: 'Basic', en: 'Basic', vi: 'Cơ bản' },
    { de: 'Mit Nagellack', en: 'With Nail Polish', vi: 'Sơn thường' },
    { de: 'Mit Shellac', en: 'With Shellac', vi: 'Shellac' },
    { de: 'Maniküre', en: 'Manicure', vi: 'Chăm sóc tay' },
    { de: 'Pediküre', en: 'Pedicure', vi: 'Chăm sóc chân' },
    { de: 'Wimpern', en: 'Eyelashes', vi: 'Lông mi' },
    { de: 'Ablösung', en: 'Removal', vi: 'Tháo móng' },
    { de: 'Zusatz', en: 'Add-on', vi: 'Bổ sung' },
    { de: 'Tự nhiên', en: 'Natural', vi: 'Tự nhiên' },
    { de: 'Cơ bản', en: 'Basic', vi: 'Cơ bản' },
    { de: 'Sơn thường', en: 'With Nail Polish', vi: 'Sơn thường' },
    { de: 'Sơn móng', en: 'Nail Polish', vi: 'Sơn móng' },
    { de: 'Tháo móng', en: 'Removal', vi: 'Tháo móng' },
    { de: 'Lông mi', en: 'Eyelashes', vi: 'Lông mi' },
    { de: 'Nối mi', en: 'Eyelash Extensions', vi: 'Nối mi' },
    { de: 'Bổ sung mi', en: 'Eyelash Refill', vi: 'Bổ sung mi' },
    { de: 'Tháo mi', en: 'Eyelash Removal', vi: 'Tháo mi' },
  ];

  for (const item of glossary) {
    if (
      item.de.toLowerCase() === lower ||
      item.en.toLowerCase() === lower ||
      item.vi.toLowerCase() === lower
    ) {
      return { vi: item.vi, en: item.en, de: item.de };
    }
  }

  // 4. Fallback if no match is found: use the same name for all languages
  return { vi: clean, en: clean, de: clean };
}

