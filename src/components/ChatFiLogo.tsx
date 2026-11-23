import React, { useState } from 'react';

interface ChatFiLogoProps {
  className?: string;
  alt?: string;
}

/**
 * Official ChatFi Logo Component:
 * Renders the official cropped ChatFi PNG icon (/chatfi-logo.png) derived from the
 * official brand asset, with an automatic razor-sharp vector SVG fallback if the
 * raster asset fails to load.
 */
export const ChatFiLogo: React.FC<ChatFiLogoProps> = ({
  className = 'h-10 w-10',
  alt = 'ChatFi',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <svg
        viewBox="0 0 512 512"
        className={`${className} shrink-0 select-none`}
        role="img"
        aria-label={alt}
      >
        <defs>
          <radialGradient id="chatfiFallbackBg" cx="50%" cy="22%" r="78%">
            <stop offset="0%" stopColor="#129640" />
            <stop offset="52%" stopColor="#0E7A34" />
            <stop offset="100%" stopColor="#074B1F" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="512" height="512" rx="116" fill="url(#chatfiFallbackBg)" />
        <path
          fill="#FFFFFF"
          fillRule="evenodd"
          d="M 262 378 C 374 378 450 306 450 228 C 450 164 404 122 340 112 C 320 80 286 64 252 64 C 214 64 182 82 164 112 C 100 124 62 178 62 246 C 62 344 146 426 262 446 L 262 378 Z M 262 308 L 262 376 C 180 356 126 300 126 244 C 126 196 158 164 202 174 C 208 140 226 122 254 122 C 282 122 300 140 306 174 C 350 166 384 192 384 234 C 384 278 334 308 262 308 Z"
        />
        <text
          x="256"
          y="258"
          textAnchor="middle"
          fill="#FFFFFF"
          fontFamily="'Plus Jakarta Sans', 'DM Sans', Arial, sans-serif"
          fontSize="56"
          fontWeight="800"
          letterSpacing="2.5"
        >
          CHATFI
        </text>
      </svg>
    );
  }

  return (
    <img
      src="/chatfi-logo.png"
      alt={alt}
      onError={() => setImgFailed(true)}
      className={`${className} shrink-0 object-contain select-none`}
      draggable={false}
    />
  );
};
