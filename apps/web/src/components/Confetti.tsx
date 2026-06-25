// Lightweight CSS confetti burst — a full-screen overlay of colored pieces
// that fall and fade once. Demo-only celebratory effect (e.g. plan upgrade).

import { createPortal } from 'react-dom';

const COLORS = ['#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#ec4899'];
const PIECES = 80;

export function Confetti() {
  const pieces = Array.from({ length: PIECES }, (_, i) => {
    const left = (i * 37) % 100;
    const delay = (i % 10) * 60;
    const duration = 1800 + ((i * 53) % 1400);
    const color = COLORS[i % COLORS.length];
    const size = 6 + ((i * 7) % 8);
    const rotate = (i * 47) % 360;
    return (
      <span
        key={i}
        className="confetti__piece"
        style={{
          left: `${left}%`,
          width: `${size}px`,
          height: `${size * 0.4}px`,
          background: color,
          animationDelay: `${delay}ms`,
          animationDuration: `${duration}ms`,
          transform: `rotate(${rotate}deg)`,
        }}
      />
    );
  });

  return createPortal(
    <div className="confetti" aria-hidden>
      {pieces}
    </div>,
    document.body,
  );
}
