export function MercadoPagoLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mercado Pago"
    >
      {/* Official MP blue circle icon */}
      <circle cx="16" cy="16" r="16" fill="#009EE3" />
      <path
        d="M8 16c0-4.418 3.582-8 8-8s8 3.582 8 8c0 2.088-.8 3.99-2.1 5.42L19.7 19.2A5.36 5.36 0 0 0 21.33 16c0-2.944-2.386-5.33-5.33-5.33S10.67 13.056 10.67 16s2.386 5.33 5.33 5.33c1.096 0 2.114-.33 2.96-.896l2.1 2.22A7.94 7.94 0 0 1 16 24c-4.418 0-8-3.582-8-8z"
        fill="#fff"
      />
      {/* Wordmark */}
      <text x="36" y="13" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="700" fontSize="9.5" fill="#009EE3" letterSpacing="0.3">MERCADO</text>
      <text x="36" y="25" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="900" fontSize="9.5" fill="#009EE3" letterSpacing="0.3">PAGO</text>
    </svg>
  );
}

export function MercadoPagoLogoWhite({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 140 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mercado Pago"
    >
      {/* White icon circle with MP mark in MP blue */}
      <circle cx="18" cy="18" r="18" fill="rgba(255,255,255,0.25)" />
      <circle cx="18" cy="18" r="14" fill="#fff" />
      <path
        d="M10 18c0-4.418 3.582-8 8-8s8 3.582 8 8c0 2.088-.8 3.99-2.1 5.42l-2.2-2.22A5.36 5.36 0 0 0 23.33 18c0-2.944-2.386-5.33-5.33-5.33S12.67 15.056 12.67 18s2.386 5.33 5.33 5.33c1.096 0 2.114-.33 2.96-.896l2.1 2.22A7.94 7.94 0 0 1 18 26c-4.418 0-8-3.582-8-8z"
        fill="#009EE3"
      />
      {/* White wordmark */}
      <text x="42" y="15" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="700" fontSize="10" fill="#fff" letterSpacing="0.5">MERCADO</text>
      <text x="42" y="28" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="900" fontSize="10" fill="#fff" letterSpacing="0.5">PAGO</text>
    </svg>
  );
}

export function UalaBisLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Ualá Bis"
    >
      {/* Ualá wordmark — rounded bold lettering in white */}
      <text x="4" y="27" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="900" fontSize="26" fill="#fff" letterSpacing="-1">ualá</text>
      {/* Bis badge */}
      <rect x="76" y="7" width="38" height="22" rx="6" fill="rgba(255,255,255,0.3)" />
      <text x="95" y="23" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="800" fontSize="13" fill="#fff" textAnchor="middle" letterSpacing="0.5">bis</text>
    </svg>
  );
}

export function PaypalLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="PayPal"
    >
      {/* PayPal two-color wordmark: Pay in #00AEEF (light blue), Pal in #003087 (dark blue on dark bg → white) */}
      <text x="0" y="24" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="900" fontSize="24" fill="#009CDE" letterSpacing="-0.5">Pay</text>
      <text x="42" y="24" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="900" fontSize="24" fill="#fff" letterSpacing="-0.5">Pal</text>
    </svg>
  );
}
