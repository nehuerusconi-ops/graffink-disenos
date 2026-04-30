/**
 * Payment provider logos using official brand colors.
 * SVG files served from /logos/ (artifacts/dreamstorm/public/logos/).
 */

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export function MercadoPagoLogo({ className }: { className?: string }) {
  return (
    <img
      src={`${BASE}/logos/mercadopago.png`}
      alt="Mercado Pago"
      className={className}
      draggable={false}
    />
  );
}

/** White version for use on the MP blue button */
export function MercadoPagoLogoWhite({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 44"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mercado Pago"
      role="img"
    >
      {/* White circle icon */}
      <circle cx="22" cy="22" r="20" fill="rgba(255,255,255,0.25)" />
      <circle cx="22" cy="22" r="16" fill="#fff" />
      {/* MP mark inside circle — brand blue */}
      <path
        d="M13 26C13 19.4 18.4 14 25 14C28.4 14 31.4 15.4 33.5 17.7L29.7 21C28.6 19.8 27 19 25.2 19C22 19 19.4 21.6 19.4 24.8V25.2C19.4 28.4 22 31 25.2 31C27 31 28.6 30.2 29.7 29L33.5 32.3C31.4 34.6 28.4 36 25 36C18.4 36 13 30.6 13 24Z"
        fill="#009EE3"
      />
      {/* White wordmark */}
      <text x="50" y="20" fontFamily="'Helvetica Neue',Arial,sans-serif" fontWeight="700" fontSize="13" fill="#fff" letterSpacing="1">MERCADO</text>
      <text x="50" y="37" fontFamily="'Helvetica Neue',Arial,sans-serif" fontWeight="900" fontSize="16" fill="#fff" letterSpacing="0.5">PAGO</text>
    </svg>
  );
}

export function UalaBisLogo({ className }: { className?: string }) {
  return (
    <img
      src={`${BASE}/logos/uala.svg`}
      alt="Ualá Bis"
      className={className}
      draggable={false}
    />
  );
}

export function PaypalLogo({ className }: { className?: string }) {
  return (
    <img
      src={`${BASE}/logos/paypal.svg`}
      alt="PayPal"
      className={className}
      draggable={false}
    />
  );
}

/** White version of PayPal logo for dark backgrounds */
export function PaypalLogoWhite({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 160 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="PayPal"
      role="img"
    >
      {/* White dual-P mark */}
      <circle cx="20" cy="20" r="18" fill="rgba(255,255,255,0.2)" />
      <circle cx="20" cy="20" r="14" fill="#fff" />
      <text x="14" y="26" fontFamily="'Helvetica Neue',Arial,sans-serif" fontWeight="900" fontSize="18" fill="#003087">P</text>
      {/* White wordmark */}
      <text x="46" y="30" fontFamily="'Helvetica Neue',Arial,sans-serif" fontWeight="900" fontSize="26" fill="#fff" letterSpacing="-1">PayPal</text>
    </svg>
  );
}
