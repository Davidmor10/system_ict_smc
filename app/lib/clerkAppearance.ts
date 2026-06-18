import { dark } from '@clerk/themes';

export const clerkAppearance = {
  baseTheme: dark,
  layout: {
    logoPlacement: 'none' as const,
    socialButtonsPlacement: 'top' as const,
    socialButtonsVariant: 'blockButton' as const,
    showOptionalFields: false,
    helpPageUrl: undefined,
  },
  variables: {
    colorPrimary: '#d4af37',
    colorBackground: '#050505',
    colorText: '#ffffff',
    colorTextSecondary: 'rgba(255,255,255,0.45)',
    colorInputBackground: '#1c1c1e',
    colorInputText: '#ffffff',
    colorNeutral: '#ffffff',
    colorDanger: '#8b3a3a',
    colorSuccess: '#4a7c59',
    borderRadius: '6px',
    fontFamily: 'var(--font-geist-sans), sans-serif',
    fontFamilyButtons: 'var(--font-geist-mono), monospace',
    fontSize: '14px',
  },
  elements: {
    // strip card chrome — our page provides the frame
    rootBox: 'w-full',
    cardBox: 'w-full shadow-none',
    card: 'bg-transparent border-0 shadow-none p-0 gap-0 w-full',

    // header — hidden; AuthScreen renders its own bilingual heading
    header: 'hidden',
    headerTitle: 'font-serif text-[30px] font-bold tracking-[0.02em] text-white',
    headerSubtitle: 'font-mono text-[12px] font-medium tracking-[0.04em] text-white/45 mt-[11px]',

    // social (Google) button — dark, bordered, mono
    socialButtonsBlockButton:
      'h-[50px] bg-[#1c1c1e] border border-[#2a2a2d] rounded-[6px] font-mono text-[13px] font-semibold tracking-[0.03em] text-white normal-case hover:bg-[#202023] hover:border-[#3a3a3d] transition-colors',
    socialButtonsBlockButtonText: 'font-mono text-[13px] font-semibold text-white normal-case',
    socialButtonsProviderIcon: 'w-[18px] h-[18px]',

    // "Last used" badge → gold
    socialButtonsBlockButtonBadge: 'text-[#d4af37] font-mono text-[9px] tracking-[0.14em] uppercase',

    // divider "or"
    dividerRow: 'my-6',
    dividerLine: 'bg-[#1c1c1e]',
    dividerText: 'font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30',

    // form fields
    formField: 'mb-5',
    formFieldLabel: 'font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55 mb-[9px]',
    formFieldInput:
      'h-[50px] bg-[#1c1c1e] border border-[#2a2a2d] rounded-[6px] px-4 font-mono text-[14px] text-white placeholder:text-[#52525b] focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/[0.12] outline-none transition-colors',

    // primary "Continue" button — solid gold + glow
    formButtonPrimary:
      'h-[52px] bg-[#d4af37] hover:bg-[#e3c768] text-black font-mono text-[13px] font-bold uppercase tracking-[0.14em] rounded-[6px] normal-case [box-shadow:0_0_26px_rgba(212,175,55,0.32)] hover:[box-shadow:0_0_40px_rgba(212,175,55,0.5)] transition-all duration-300',

    // footer link
    footer: 'mt-[26px]',
    footerAction: 'justify-center',
    footerActionText: 'font-mono text-[12px] font-medium text-white/45',
    footerActionLink: 'font-mono text-[12px] font-bold text-[#d4af37] hover:text-[#e3c768] no-underline',

    // hide Clerk branding + dev badge
    footerPages: 'hidden',
    logoBox: 'hidden',
    badge: 'hidden',
    footer__clerk: 'hidden',
    internal__clerkBranding: 'hidden',

    // OTP / verification (sign-up flow)
    formResendCodeLink: 'text-[#d4af37] font-mono',
    otpCodeFieldInput: 'bg-[#1c1c1e] border border-[#2a2a2d] text-white focus:border-[#d4af37]',
    identityPreviewText: 'text-white font-mono',
    identityPreviewEditButton: 'text-[#d4af37]',

    // user button popover (used elsewhere)
    userButtonPopoverCard: 'bg-[#0d0d0f] border border-[#1c1c1e]',
    userButtonPopoverActionButton: 'text-white hover:bg-[#1c1c1e]',
  },
};
