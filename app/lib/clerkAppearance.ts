import { dark } from '@clerk/themes';

// Shared Clerk appearance — Onyx pitch-black + Institutional Gold (#d4af37).
// `baseTheme: dark` forces a dark starting palette so auth modals never flash
// white before our variables/elements apply.
export const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: '#d4af37',
    colorBackground: '#0d0d0f',
    colorText: '#ffffff',
    colorTextSecondary: '#c0c0c0',
    colorInputBackground: '#1c1c1e',
    colorInputText: '#ffffff',
    colorNeutral: '#ffffff',
    colorDanger: '#8b3a3a',
    colorSuccess: '#4a7c59',
    borderRadius: '0.375rem',
    fontFamily: 'var(--font-geist-sans), sans-serif',
  },
  elements: {
    rootBox: 'w-full',
    card: 'bg-[#0d0d0f] border border-[#1c1c1e] shadow-[0_0_70px_-20px_rgba(212,175,55,0.35)]',
    headerTitle: 'text-white font-serif tracking-wide',
    headerSubtitle: 'text-white/55',
    socialButtonsBlockButton: 'bg-[#1c1c1e] border border-[#2a2a2d] text-white hover:bg-[#2a2a2d]',
    dividerLine: 'bg-[#1c1c1e]',
    dividerText: 'text-white/40',
    formFieldLabel: 'text-white/70 font-bold',
    formFieldInput: 'bg-[#1c1c1e] border border-[#2a2a2d] text-white focus:border-[#d4af37]',
    formButtonPrimary: 'bg-[#d4af37] hover:bg-[#c9a227] text-black font-bold normal-case shadow-[0_0_24px_rgba(212,175,55,0.4)]',
    footerActionText: 'text-white/55',
    footerActionLink: 'text-[#d4af37] hover:text-[#d4af37] font-bold',
    identityPreviewText: 'text-white',
    formResendCodeLink: 'text-[#d4af37]',
    profileSectionPrimaryButton: 'text-[#d4af37]',
    userButtonPopoverCard: 'bg-[#0d0d0f] border border-[#1c1c1e]',
    userButtonPopoverActionButton: 'text-white hover:bg-[#1c1c1e]',
  },
};
