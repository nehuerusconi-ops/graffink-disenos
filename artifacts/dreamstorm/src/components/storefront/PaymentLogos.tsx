export function MercadoPagoLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mercado Pago"
    >
      <circle cx="12" cy="12" r="12" fill="#009EE3" />
      <path
        d="M7 12.5C7 9.46 9.46 7 12.5 7C14.19 7 15.7 7.76 16.73 8.97L14.36 11.12C13.88 10.51 13.14 10.12 12.3 10.12C10.74 10.12 9.47 11.26 9.47 12.5C9.47 13.74 10.74 14.88 12.3 14.88C13.14 14.88 13.88 14.49 14.36 13.88L16.73 16.03C15.7 17.24 14.19 18 12.5 18C9.46 18 7 15.54 7 12.5Z"
        fill="white"
      />
      <text x="28" y="17" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="11" fill="#009EE3">
        MERCADO
      </text>
      <text x="28" y="28" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="11" fill="#009EE3">
        PAGO
      </text>
    </svg>
  );
}

export function MercadoPagoLogoWhite({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mercado Pago"
    >
      <circle cx="16" cy="16" r="15" fill="white" fillOpacity="0.2" />
      <circle cx="16" cy="16" r="11" fill="white" />
      <path
        d="M10 16.5C10 13.46 12.46 11 15.5 11C17.19 11 18.7 11.76 19.73 12.97L17.36 15.12C16.88 14.51 16.14 14.12 15.3 14.12C13.74 14.12 12.47 15.26 12.47 16.5C12.47 17.74 13.74 18.88 15.3 18.88C16.14 18.88 16.88 18.49 17.36 17.88L19.73 20.03C18.7 21.24 17.19 22 15.5 22C12.46 22 10 19.54 10 16.5Z"
        fill="#009EE3"
      />
      <text x="36" y="14" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="10" fill="white" letterSpacing="0.5">
        MERCADO
      </text>
      <text x="36" y="26" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="10" fill="white" letterSpacing="0.5">
        PAGO
      </text>
    </svg>
  );
}

export function UalaBisLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Ualá Bis"
    >
      <rect width="100" height="32" rx="4" fill="white" fillOpacity="0.15" />
      <text x="10" y="22" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="18" fill="white" letterSpacing="-0.5">
        ualá
      </text>
      <rect x="56" y="6" width="34" height="20" rx="3" fill="white" fillOpacity="0.25" />
      <text x="73" y="21" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="12" fill="white" textAnchor="middle" letterSpacing="0.5">
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
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="PayPal"
    >
      <text x="2" y="23" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="22" fill="#00AEEF" letterSpacing="-1">
        Pay
      </text>
      <text x="42" y="23" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="22" fill="white" letterSpacing="-1">
        Pal
      </text>
    </svg>
  );
}
