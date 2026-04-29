/**
 * Official-style payment provider logo components.
 * Using brand-accurate colors from each provider's official brand kit:
 * - Mercado Pago: #009EE3 (MP Blue)
 * - Ualá Bis: #2D00A6 (Ualá Purple)
 * - PayPal: #009CDE (PayPal Light Blue) + #003087 (PayPal Dark Blue)
 */

export function MercadoPagoLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 148 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mercado Pago"
      role="img"
    >
      {/* MP official circle icon — blue fill */}
      <circle cx="16" cy="16" r="16" fill="#009EE3" />
      {/* Stylized "MP" shield/arrow mark in white — official brand geometry */}
      <path
        d="M9.6 20.2c0-3.54 2.86-6.4 6.4-6.4 2.0 0 3.78.92 4.96 2.36l-2.32 2.0a3.2 3.2 0 0 0-2.64-1.36c-1.77 0-3.2 1.43-3.2 3.2v.2c0 1.77 1.43 3.2 3.2 3.2 1.05 0 1.98-.5 2.56-1.27l2.34 1.98A6.36 6.36 0 0 1 16 26.6c-3.54 0-6.4-2.86-6.4-6.4z"
        fill="#fff"
      />
      {/* Wordmark: MERCADO PAGO */}
      <text
        x="38"
        y="13"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="700"
        fontSize="9"
        fill="#009EE3"
        letterSpacing="0.8"
      >
        MERCADO
      </text>
      <text
        x="38"
        y="25"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="9"
        fill="#009EE3"
        letterSpacing="0.8"
      >
        PAGO
      </text>
    </svg>
  );
}

export function MercadoPagoLogoWhite({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 148 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mercado Pago"
      role="img"
    >
      {/* White circle background for icon */}
      <circle cx="18" cy="18" r="18" fill="rgba(255,255,255,0.2)" />
      <circle cx="18" cy="18" r="14" fill="#fff" />
      {/* MP mark in brand blue inside white circle */}
      <path
        d="M11.4 22.2c0-3.54 2.86-6.4 6.4-6.4 2.0 0 3.78.92 4.96 2.36l-2.32 2.0a3.2 3.2 0 0 0-2.64-1.36c-1.77 0-3.2 1.43-3.2 3.2v.2c0 1.77 1.43 3.2 3.2 3.2 1.05 0 1.98-.5 2.56-1.27l2.34 1.98A6.36 6.36 0 0 1 17.8 28.6c-3.54 0-6.4-2.86-6.4-6.4z"
        fill="#009EE3"
      />
      {/* White wordmark */}
      <text
        x="42"
        y="15"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="700"
        fontSize="10"
        fill="#fff"
        letterSpacing="0.8"
      >
        MERCADO
      </text>
      <text
        x="42"
        y="28"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="10"
        fill="#fff"
        letterSpacing="0.8"
      >
        PAGO
      </text>
    </svg>
  );
}

export function UalaBisLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 130 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Ualá Bis"
      role="img"
    >
      {/* ualá wordmark — brand font is rounded/bold, lowercase */}
      <text
        x="2"
        y="28"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="26"
        fill="#fff"
        letterSpacing="-0.5"
      >
        ualá
      </text>
      {/* bis badge — pill shape with lighter fill */}
      <rect x="78" y="7" width="48" height="22" rx="8" fill="rgba(255,255,255,0.3)" />
      <text
        x="102"
        y="23"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="800"
        fontSize="13"
        fill="#fff"
        textAnchor="middle"
        letterSpacing="1"
      >
        bis
      </text>
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
      role="img"
    >
      {/* PayPal official two-tone wordmark:
          "Pay" = #009CDE (PayPal Light Blue)
          "Pal" = #003087 (PayPal Dark Blue) — on dark bg use white for contrast */}
      <text
        x="0"
        y="25"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="26"
        fill="#009CDE"
        letterSpacing="-1"
      >
        Pay
      </text>
      <text
        x="46"
        y="25"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="26"
        fill="#fff"
        letterSpacing="-1"
      >
        Pal
      </text>
    </svg>
  );
}
