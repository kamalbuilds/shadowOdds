"use client";

interface CryptoIconProps {
  symbol: string;
  size?: number;
}

function EthIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#627EEA" fillOpacity="0.15" />
      <path d="M16 4L15.82 4.61V20.84L16 21.02L23.5 16.7L16 4Z" fill="#627EEA" fillOpacity="0.6" />
      <path d="M16 4L8.5 16.7L16 21.02V13.07V4Z" fill="#627EEA" />
      <path d="M16 22.72L15.9 22.84V28.72L16 29L23.5 18.4L16 22.72Z" fill="#627EEA" fillOpacity="0.6" />
      <path d="M16 29V22.72L8.5 18.4L16 29Z" fill="#627EEA" />
      <path d="M16 21.02L23.5 16.7L16 13.07V21.02Z" fill="#627EEA" fillOpacity="0.2" />
      <path d="M8.5 16.7L16 21.02V13.07L8.5 16.7Z" fill="#627EEA" fillOpacity="0.6" />
    </svg>
  );
}

function BtcIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#F7931A" fillOpacity="0.15" />
      <path
        d="M22.5 14.2C22.8 12.2 21.3 11.1 19.2 10.4L19.9 7.6L18.2 7.2L17.5 9.9C17.1 9.8 16.6 9.7 16.2 9.6L16.9 6.9L15.2 6.5L14.5 9.3C14.2 9.2 13.8 9.1 13.5 9.1L11.2 8.5L10.7 10.3C10.7 10.3 12 10.6 11.9 10.6C12.7 10.8 12.8 11.3 12.8 11.7L12 14.9C12.1 14.9 12.1 14.9 12.2 15L12 14.9L10.9 19.2C10.8 19.4 10.6 19.8 10 19.6C10 19.6 8.8 19.3 8.8 19.3L8 21.3L10.2 21.8C10.6 21.9 10.9 22 11.3 22.1L10.6 24.9L12.3 25.3L13 22.5C13.4 22.6 13.9 22.7 14.3 22.8L13.6 25.6L15.3 26L16 23.2C18.9 23.8 21.1 23.5 22 21C22.7 18.9 21.9 17.7 20.4 17C21.5 16.7 22.3 16 22.5 14.2ZM18.7 20.1C18.2 22.2 14.7 21 13.6 20.7L14.5 17.1C15.6 17.4 19.3 18 18.7 20.1ZM19.2 14.2C18.8 16.1 15.8 15.1 14.9 14.9L15.7 11.5C16.6 11.8 19.7 12.2 19.2 14.2Z"
        fill="#F7931A"
      />
    </svg>
  );
}

function SolIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#9945FF" fillOpacity="0.15" />
      <path d="M10.2 20.1C10.3 20 10.5 19.9 10.7 19.9H24.3C24.6 19.9 24.7 20.3 24.5 20.5L22 23C21.9 23.1 21.7 23.2 21.5 23.2H7.9C7.6 23.2 7.5 22.8 7.7 22.6L10.2 20.1Z" fill="#9945FF" />
      <path d="M10.2 9C10.3 8.9 10.5 8.8 10.7 8.8H24.3C24.6 8.8 24.7 9.2 24.5 9.4L22 11.9C21.9 12 21.7 12.1 21.5 12.1H7.9C7.6 12.1 7.5 11.7 7.7 11.5L10.2 9Z" fill="#9945FF" />
      <path d="M22 14.5C21.9 14.4 21.7 14.3 21.5 14.3H7.9C7.6 14.3 7.5 14.7 7.7 14.9L10.2 17.4C10.3 17.5 10.5 17.6 10.7 17.6H24.3C24.6 17.6 24.7 17.2 24.5 17L22 14.5Z" fill="#9945FF" />
    </svg>
  );
}

function DogeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#C2A633" fillOpacity="0.15" />
      <path
        d="M14.2 9H12V23H14.2C14.2 23 22 23.2 22 16.1C22 9 14.2 9 14.2 9ZM15.2 20.8V11.2C15.2 11.2 20 10.8 20 16C20 21.2 15.2 20.8 15.2 20.8Z"
        fill="#C2A633"
      />
      <rect x="10" y="15" width="8" height="2" rx="0.5" fill="#C2A633" />
    </svg>
  );
}

function MonadIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#836EF9" fillOpacity="0.15" />
      <path
        d="M8 22V10L12 18L16 10L20 18L24 10V22"
        stroke="#836EF9"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function DefaultIcon({ size, symbol }: { size: number; symbol: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#00e87b" fillOpacity="0.15" />
      <text x="16" y="20" textAnchor="middle" fill="#00e87b" fontSize="14" fontWeight="bold" fontFamily="system-ui">
        {symbol.charAt(0)}
      </text>
    </svg>
  );
}

export function CryptoIcon({ symbol, size = 28 }: CryptoIconProps) {
  switch (symbol) {
    case "ETH":
      return <EthIcon size={size} />;
    case "BTC":
      return <BtcIcon size={size} />;
    case "SOL":
      return <SolIcon size={size} />;
    case "DOGE":
      return <DogeIcon size={size} />;
    case "MON":
      return <MonadIcon size={size} />;
    default:
      return <DefaultIcon size={size} symbol={symbol} />;
  }
}
