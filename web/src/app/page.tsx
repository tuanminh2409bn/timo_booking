'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import SplitText from '@/components/reactbits/SplitText';
import BlurText from '@/components/reactbits/BlurText';
import CountUp from '@/components/reactbits/CountUp';
import ShinyText from '@/components/reactbits/ShinyText';
import ClickSpark from '@/components/reactbits/ClickSpark';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import AnimatedContent from '@/components/reactbits/AnimatedContent';
import Threads from '@/components/reactbits/Threads';
import ScrollReveal from '@/components/reactbits/ScrollReveal';
import styles from './page.module.css';

/* ── SVG Icon Components ── */
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <rect x="8" y="14" width="3" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.3" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <path d="M2 20h20" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* Step Icons */
function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* ── Testimonial Data ── */
const testimonials = [
  {
    quote: {
      de: 'Seit wir Timmo Booking nutzen, haben sich unsere No-Shows um 60% reduziert. Die automatischen Erinnerungen sind Gold wert!',
      en: 'Since using Timmo Booking, our no-shows dropped by 60%. The automatic reminders are worth their weight in gold!',
      vi: 'Từ khi dùng Timmo Booking, khách hủy hẹn giảm 60%. Tính năng nhắc nhở tự động thật quý giá!',
    },
    name: 'Lisa Nguyen',
    salon: 'Nailart Studio Berlin',
    initials: 'LN',
  },
  {
    quote: {
      de: 'Endlich ein Buchungssystem, das wirklich für Nagelstudios gemacht ist. Einfach, schön und unsere Kunden lieben es.',
      en: 'Finally a booking system truly made for nail salons. Simple, beautiful, and our clients love it.',
      vi: 'Cuối cùng cũng có hệ thống đặt lịch dành riêng cho tiệm nail. Đơn giản, đẹp và khách hàng rất thích.',
    },
    name: 'Maria Schmidt',
    salon: 'Glamour Nails München',
    initials: 'MS',
  },
  {
    quote: {
      de: 'Die Einrichtung hat nur 5 Minuten gedauert. Am gleichen Tag hatten wir schon die ersten Online-Buchungen. Fantastisch!',
      en: 'Setup took only 5 minutes. We had our first online bookings the same day. Fantastic!',
      vi: 'Chỉ mất 5 phút để cài đặt. Cùng ngày đã có booking online đầu tiên. Tuyệt vời!',
    },
    name: 'Tran Minh',
    salon: 'Beauty Lounge Hamburg',
    initials: 'TM',
  },
];

/* ── Main Landing Page ── */
export default function LandingPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const goToBooking = useCallback(() => {
    router.push('/book');
  }, [router]);

  const handleContactSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setContactSending(true);
    setTimeout(() => {
      setContactSending(false);
      setContactSent(true);
      (e.target as HTMLFormElement).reset();
      setTimeout(() => setContactSent(false), 5000);
    }, 1500);
  }, []);

  const featureItems = [
    { icon: <CalendarIcon />, title: t.landing.features.onlineBooking.title, desc: t.landing.features.onlineBooking.description },
    { icon: <PeopleIcon />, title: t.landing.features.staffManagement.title, desc: t.landing.features.staffManagement.description },
    { icon: <GridIcon />, title: t.landing.features.calendar.title, desc: t.landing.features.calendar.description },
    { icon: <BellIcon />, title: t.landing.features.smsNotification.title, desc: t.landing.features.smsNotification.description },
    { icon: <MapPinIcon />, title: t.landing.features.multiLocation.title, desc: t.landing.features.multiLocation.description },
    { icon: <ChartIcon />, title: t.landing.features.analytics.title, desc: t.landing.features.analytics.description },
  ];

  const stepIcons = [<StoreIcon key="store" />, <UsersIcon key="users" />, <ShareIcon key="share" />];
  const steps = [t.landing.howItWorks.steps.step1, t.landing.howItWorks.steps.step2, t.landing.howItWorks.steps.step3];

  return (
    <ClickSpark sparkColor="#1A1A1A" sparkCount={8} sparkRadius={15}>
      {/* ═══════ NAVIGATION ═══════ */}
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
        <div className={styles.navInner}>
          <a href="/" className={styles.logo}>
            Timmo<span className={styles.logoDot} />Booking
          </a>

          <div className={styles.navLinks}>
            <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }} className={styles.navLink}>
              {t.landing.nav.features}
            </a>
            <a href="#how-it-works" onClick={(e) => { e.preventDefault(); scrollTo('how-it-works'); }} className={styles.navLink}>
              {t.landing.nav.howItWorks}
            </a>
            <a href="#pricing" onClick={(e) => { e.preventDefault(); scrollTo('pricing'); }} className={styles.navLink}>
              {t.landing.nav.pricing}
            </a>
            <a href="#contact" onClick={(e) => { e.preventDefault(); scrollTo('contact'); }} className={styles.navLink}>
              {t.landing.nav.contact}
            </a>
          </div>

          <div className={styles.navActions}>
            <a href="/admin/login" className={styles.navLogin}>
              {t.landing.nav.loginAdmin}
            </a>
            <LanguageSwitcher variant="light" />
            <a href="/book" className={styles.navCta}>
              {t.landing.hero.ctaClient}
            </a>
          </div>
        </div>
      </nav>

      {/* ═══════ HERO SECTION ═══════ */}
      <section className={styles.hero}>
        {/* Threads Background */}
        <div className={styles.heroThreads}>
          <Threads
            color={[59, 130, 246]}
            amplitude={0.8}
            distance={0}
            enableMouseInteraction={true}
          />
        </div>

        {/* Content */}
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            {t.landing.hero.badge}
          </div>

          <SplitText
            text={`${t.landing.hero.title} ${t.landing.hero.titleHighlight}`}
            className={styles.heroTitle}
            delay={50}
            animationFrom={{ opacity: 0, transform: 'translate3d(0,50px,0)' }}
            animationTo={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
            textAlign="center"
            threshold={0.1}
            rootMargin="-50px"
          />

          <BlurText
            text={t.landing.hero.subtitle}
            className={styles.heroSubtitle}
            delay={80}
            animateBy="words"
            direction="bottom"
          />

          <div className={styles.heroActions}>
            <a href="/book" className={styles.btnPrimary}>
              {t.landing.hero.ctaClient}
              <ArrowRightIcon />
            </a>
            <a href="/admin/login" className={styles.btnSecondary}>
              <span className={styles.btnIcon}>💼</span>
              {t.landing.hero.ctaAdmin}
            </a>
          </div>

          {/* Stats Row */}
          <div className={styles.heroStats}>
            <div className={styles.statItem}>
              <div className={styles.statValue}>
                <CountUp to={2500} from={0} duration={2.5} separator="," className={styles.countUpValue} />
                <span>+</span>
              </div>
              <div className={styles.statLabel}>{t.landing.hero.stats.salons}</div>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <div className={styles.statValue}>
                <CountUp to={150} from={0} duration={2.5} className={styles.countUpValue} />
                <span>K+</span>
              </div>
              <div className={styles.statLabel}>{t.landing.hero.stats.bookings}</div>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <div className={styles.statValue}>
                <CountUp to={99} from={0} duration={2} className={styles.countUpValue} />
                <span>%</span>
              </div>
              <div className={styles.statLabel}>{t.landing.hero.stats.satisfaction}</div>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <div className={styles.statValue}>
                <CountUp to={12} from={0} duration={1.8} className={styles.countUpValue} />
                <span>+</span>
              </div>
              <div className={styles.statLabel}>{t.landing.hero.stats.countries}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ FEATURES SECTION ═══════ */}
      <section id="features" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionBadge}>{t.landing.features.badge}</span>
            <h2 className={styles.sectionTitle}>
              {t.landing.features.title}{' '}
              <span className={styles.titleHighlight}>{t.landing.features.titleHighlight}</span>
            </h2>
            <ScrollReveal
              enableBlur={true}
              baseOpacity={0.15}
              baseRotation={2}
              blurStrength={3}
              textClassName={styles.sectionSubtitle}
            >
              {t.landing.features.subtitle}
            </ScrollReveal>
          </div>

          <div className={styles.featuresGrid}>
            {featureItems.map((feature, i) => (
              <AnimatedContent key={i} distance={60} direction="vertical" delay={i * 0.1} threshold={0.05}>
                <SpotlightCard className={styles.featureCard} spotlightColor="rgba(26, 26, 26, 0.06)">
                  <div className={styles.featureCardInner}>
                    <div className={styles.featureIcon}>{feature.icon}</div>
                    <h3 className={styles.featureTitle}>{feature.title}</h3>
                    <p className={styles.featureDescription}>{feature.desc}</p>
                  </div>
                </SpotlightCard>
              </AnimatedContent>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ HOW IT WORKS SECTION ═══════ */}
      <section id="how-it-works" className={`${styles.section} ${styles.sectionWhite}`}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionBadge}>{t.landing.howItWorks.badge}</span>
            <h2 className={styles.sectionTitle}>
              {t.landing.howItWorks.title}{' '}
              <span className={styles.titleHighlight}>{t.landing.howItWorks.titleHighlight}</span>
            </h2>
            <ScrollReveal
              enableBlur={true}
              baseOpacity={0.15}
              baseRotation={2}
              blurStrength={3}
              textClassName={styles.sectionSubtitle}
            >
              {t.landing.howItWorks.subtitle}
            </ScrollReveal>
          </div>

          <div className={styles.stepsContainer}>
            <div className={styles.stepsLine} />
            {steps.map((step, i) => (
              <AnimatedContent key={i} distance={80} direction="vertical" delay={i * 0.2} threshold={0.1}>
                <div className={styles.stepItem}>
                  <div className={styles.stepNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div className={styles.stepIcon}>{stepIcons[i]}</div>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepDescription}>{step.description}</p>
                </div>
              </AnimatedContent>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ TESTIMONIALS SECTION ═══════ */}
      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionBadge}>{t.landing.testimonials.badge}</span>
            <h2 className={styles.sectionTitle}>
              {t.landing.testimonials.title}{' '}
              <span className={styles.titleHighlight}>{t.landing.testimonials.titleHighlight}</span>
            </h2>
          </div>

          <div className={styles.testimonialsGrid}>
            {testimonials.map((item, i) => (
              <AnimatedContent key={i} distance={60} direction="vertical" delay={i * 0.15} threshold={0.1}>
                <div className={styles.testimonialCard}>
                  <div className={styles.testimonialStars}>
                    {[...Array(5)].map((_, j) => (
                      <span key={j} className={styles.star}><StarIcon /></span>
                    ))}
                  </div>
                  <p className={styles.testimonialQuote}>
                    &ldquo;{item.quote[locale as keyof typeof item.quote]}&rdquo;
                  </p>
                  <div className={styles.testimonialAuthor}>
                    <div className={styles.testimonialAvatar}>{item.initials}</div>
                    <div>
                      <div className={styles.testimonialName}>{item.name}</div>
                      <div className={styles.testimonialSalon}>{item.salon}</div>
                    </div>
                  </div>
                </div>
              </AnimatedContent>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ PRICING SECTION ═══════ */}
      <section id="pricing" className={`${styles.section} ${styles.sectionWhite}`}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionBadge}>{t.landing.pricing.badge}</span>
            <h2 className={styles.sectionTitle}>
              {t.landing.pricing.title}{' '}
              <span className={styles.titleHighlight}>{t.landing.pricing.titleHighlight}</span>
            </h2>
            <ScrollReveal
              enableBlur={true}
              baseOpacity={0.15}
              baseRotation={2}
              blurStrength={3}
              textClassName={styles.sectionSubtitle}
            >
              {t.landing.pricing.subtitle}
            </ScrollReveal>
          </div>

          <div className={styles.pricingGrid}>
            {/* Starter Plan */}
            <AnimatedContent distance={60} direction="vertical" delay={0} threshold={0.05}>
              <div className={styles.pricingCard}>
                <h3 className={styles.pricingPlanName}>{t.landing.pricing.plans.starter.name}</h3>
                <div className={styles.pricingPriceRow}>
                  <span className={styles.pricingCurrency}>€</span>
                  <span className={styles.pricingPrice}>{t.landing.pricing.plans.starter.price}</span>
                  <span className={styles.pricingPeriod}>{t.landing.pricing.perMonth}</span>
                </div>
                <p className={styles.pricingDescription}>{t.landing.pricing.plans.starter.description}</p>
                <ul className={styles.pricingFeatureList}>
                  {t.landing.pricing.plans.starter.features.map((feature, i) => (
                    <li key={i} className={styles.pricingFeatureItem}>
                      <span className={styles.pricingCheckIcon}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <a href="/book" className={styles.pricingButton}>{t.landing.pricing.getStarted}</a>
              </div>
            </AnimatedContent>

            {/* Professional Plan (Popular) */}
            <AnimatedContent distance={60} direction="vertical" delay={0.15} threshold={0.05}>
              <div className={`${styles.pricingCard} ${styles.pricingCardPopular}`}>
                <span className={styles.pricingPopularBadge}>{t.landing.pricing.popular}</span>
                <h3 className={styles.pricingPlanName}>{t.landing.pricing.plans.professional.name}</h3>
                <div className={styles.pricingPriceRow}>
                  <span className={styles.pricingCurrency}>€</span>
                  <span className={styles.pricingPrice}>{t.landing.pricing.plans.professional.price}</span>
                  <span className={styles.pricingPeriod}>{t.landing.pricing.perMonth}</span>
                </div>
                <p className={styles.pricingDescription}>{t.landing.pricing.plans.professional.description}</p>
                <ul className={styles.pricingFeatureList}>
                  {t.landing.pricing.plans.professional.features.map((feature, i) => (
                    <li key={i} className={styles.pricingFeatureItem}>
                      <span className={styles.pricingCheckIcon}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <a href="/book" className={`${styles.pricingButton} ${styles.pricingButtonPrimary}`}>{t.landing.pricing.getStarted}</a>
              </div>
            </AnimatedContent>

            {/* Enterprise Plan */}
            <AnimatedContent distance={60} direction="vertical" delay={0.3} threshold={0.05}>
              <div className={styles.pricingCard}>
                <h3 className={styles.pricingPlanName}>{t.landing.pricing.plans.enterprise.name}</h3>
                <div className={styles.pricingPriceRow}>
                  <span className={styles.pricingCurrency}>€</span>
                  <span className={styles.pricingPrice}>{t.landing.pricing.plans.enterprise.price}</span>
                  <span className={styles.pricingPeriod}>{t.landing.pricing.perMonth}</span>
                </div>
                <p className={styles.pricingDescription}>{t.landing.pricing.plans.enterprise.description}</p>
                <ul className={styles.pricingFeatureList}>
                  {t.landing.pricing.plans.enterprise.features.map((feature, i) => (
                    <li key={i} className={styles.pricingFeatureItem}>
                      <span className={styles.pricingCheckIcon}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <button className={styles.pricingButton} onClick={() => scrollTo('contact')}>{t.landing.pricing.contactSales}</button>
              </div>
            </AnimatedContent>
          </div>
        </div>
      </section>

      {/* ═══════ CTA SECTION ═══════ */}
      <section className={`${styles.section} ${styles.sectionWhite} ${styles.ctaSection}`}>
        <div className={styles.ctaContent}>
          <h2 className={styles.ctaTitle}>
            {t.landing.cta.title}{' '}
            <ShinyText text={t.landing.cta.titleHighlight} speed={4} className={styles.ctaShiny} />
          </h2>
          <p className={styles.ctaSubtitle}>{t.landing.cta.subtitle}</p>
          <a href="/book" className={styles.ctaButton}>
            {t.landing.cta.button}
            <ArrowRightIcon />
          </a>
          <p className={styles.ctaNote}>{t.landing.cta.note}</p>

          <div className={styles.ctaTrust}>
            <div className={styles.trustItem}>
              <span className={styles.trustIcon}><ShieldIcon /></span>
              SSL Encrypted
            </div>
            <div className={styles.trustItem}>
              <span className={styles.trustIcon}><CheckIcon /></span>
              GDPR Compliant
            </div>
            <div className={styles.trustItem}>
              <span className={styles.trustIcon}><CheckIcon /></span>
              99.9% Uptime
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ CONTACT SECTION ═══════ */}
      <section id="contact" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionBadge}>{t.landing.contact.badge}</span>
            <h2 className={styles.sectionTitle}>
              {t.landing.contact.title}{' '}
              <span className={styles.titleHighlight}>{t.landing.contact.titleHighlight}</span>
            </h2>
            <ScrollReveal
              enableBlur={true}
              baseOpacity={0.15}
              baseRotation={2}
              blurStrength={3}
              textClassName={styles.sectionSubtitle}
            >
              {t.landing.contact.subtitle}
            </ScrollReveal>
          </div>

          <div className={styles.contactGrid}>
            {/* Contact Form */}
            <AnimatedContent distance={60} direction="horizontal" delay={0} threshold={0.1}>
              <form className={styles.contactForm} onSubmit={handleContactSubmit}>
                <div className={styles.contactFieldGroup}>
                  <label className={styles.contactLabel}>{t.landing.contact.form.name}</label>
                  <input
                    type="text"
                    className={styles.contactInput}
                    placeholder={t.landing.contact.form.namePlaceholder}
                    required
                  />
                </div>
                <div className={styles.contactFieldGroup}>
                  <label className={styles.contactLabel}>{t.landing.contact.form.email}</label>
                  <input
                    type="email"
                    className={styles.contactInput}
                    placeholder={t.landing.contact.form.emailPlaceholder}
                    required
                  />
                </div>
                <div className={styles.contactFieldGroup}>
                  <label className={styles.contactLabel}>{t.landing.contact.form.subject}</label>
                  <input
                    type="text"
                    className={styles.contactInput}
                    placeholder={t.landing.contact.form.subjectPlaceholder}
                    required
                  />
                </div>
                <div className={styles.contactFieldGroup}>
                  <label className={styles.contactLabel}>{t.landing.contact.form.message}</label>
                  <textarea
                    className={styles.contactTextarea}
                    placeholder={t.landing.contact.form.messagePlaceholder}
                    rows={5}
                    required
                  />
                </div>
                {contactSent && (
                  <div className={styles.contactSuccess}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="20 6 9 17 4 12" /></svg>
                    {t.landing.contact.form.success}
                  </div>
                )}
                <button type="submit" className={styles.contactSubmitButton} disabled={contactSending}>
                  {contactSending ? t.landing.contact.form.sending : t.landing.contact.form.send}
                  {!contactSending && <ArrowRightIcon />}
                </button>
              </form>
            </AnimatedContent>

            {/* Contact Info */}
            <AnimatedContent distance={60} direction="horizontal" delay={0.2} threshold={0.1}>
              <div className={styles.contactInfoGrid}>
                <div className={styles.contactInfoCard}>
                  <div className={styles.contactInfoIcon}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  </div>
                  <h4 className={styles.contactInfoTitle}>{t.landing.contact.info.office}</h4>
                  <a href="https://maps.google.com/?q=Kurfürstendamm+123+Berlin" target="_blank" rel="noopener noreferrer" className={styles.contactInfoLink}>{t.landing.contact.info.officeAddress}</a>
                </div>

                <div className={styles.contactInfoCard}>
                  <div className={styles.contactInfoIcon}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  </div>
                  <h4 className={styles.contactInfoTitle}>{t.landing.contact.info.email}</h4>
                  <a href="mailto:hello@timmobooking.de" className={styles.contactInfoLink}>{t.landing.contact.info.emailAddress}</a>
                </div>

                <div className={styles.contactInfoCard}>
                  <div className={styles.contactInfoIcon}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  </div>
                  <h4 className={styles.contactInfoTitle}>{t.landing.contact.info.phone}</h4>
                  <a href="tel:+493012345678" className={styles.contactInfoLink}>{t.landing.contact.info.phoneNumber}</a>
                </div>

                <div className={styles.contactInfoCard}>
                  <div className={styles.contactInfoIcon}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  </div>
                  <h4 className={styles.contactInfoTitle}>{t.landing.contact.info.hours}</h4>
                  <p className={styles.contactInfoText}>{t.landing.contact.info.hoursDetail}</p>
                </div>
              </div>
            </AnimatedContent>
          </div>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerGrid}>
            <div className={styles.footerBrand}>
              <div className={styles.footerLogo}>
                Timmo<span className={styles.logoDotLight} />Booking
              </div>
              <p className={styles.footerDescription}>{t.landing.footer.description}</p>
            </div>

            <div className={styles.footerColumn}>
              <h4>{t.landing.footer.product}</h4>
              <ul>
                <li><a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); }}>{t.landing.nav.features}</a></li>
                <li><a href="#pricing" onClick={(e) => { e.preventDefault(); scrollTo('pricing'); }}>{t.landing.nav.pricing}</a></li>
                <li><a href="#">API</a></li>
                <li><a href="#">Integrations</a></li>
              </ul>
            </div>

            <div className={styles.footerColumn}>
              <h4>{t.landing.footer.company}</h4>
              <ul>
                <li><a href="#how-it-works" onClick={(e) => { e.preventDefault(); scrollTo('how-it-works'); }}>{t.landing.footer.about}</a></li>
                <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollTo('contact'); }}>{t.landing.footer.careers}</a></li>
                <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollTo('contact'); }}>{t.landing.footer.blog}</a></li>
                <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollTo('contact'); }}>{t.landing.footer.press}</a></li>
              </ul>
            </div>

            <div className={styles.footerColumn}>
              <h4>{t.landing.footer.legal}</h4>
              <ul>
                <li><a href="/privacy">{t.landing.footer.privacy}</a></li>
                <li><a href="/terms">{t.landing.footer.terms}</a></li>
                <li><a href="/cookies">{t.landing.footer.cookies}</a></li>
              </ul>
            </div>
          </div>

          <div className={styles.footerBottom}>
            <span className={styles.footerCopyright}>{t.landing.footer.copyright}</span>
            <div className={styles.footerSocials}>
              <a href="#" className={styles.socialLink} aria-label="Twitter">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="#" className={styles.socialLink} aria-label="LinkedIn">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
              <a href="#" className={styles.socialLink} aria-label="Instagram">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </ClickSpark>
  );
}
