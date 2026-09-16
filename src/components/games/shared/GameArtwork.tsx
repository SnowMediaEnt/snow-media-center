import type { GameAccent } from './gameTypes';

/**
 * Lightweight per-game lobby artwork. SVG only — no emoji, no bitmaps — so it
 * stays crisp on 4K panels and costs nothing on a legacy TV WebView.
 */
export const GameArtwork = ({ game, accent }: { game: string; accent: GameAccent }) => {
  const common = {
    className: `snow-game-art snow-game-art--${game}`,
    viewBox: '0 0 320 200',
    preserveAspectRatio: 'xMidYMid meet',
    focusable: 'false' as const,
    'aria-hidden': true as const,
    'data-accent': accent,
  };

  switch (game) {
    case 'daily-spin':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="daily-wheel-rim" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff2b8" /><stop offset=".48" stopColor="#d5a938" /><stop offset="1" stopColor="#81531a" /></linearGradient>
            <linearGradient id="daily-wheel-face" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#174e78" /><stop offset="1" stopColor="#071b3b" /></linearGradient>
          </defs>
          <ellipse className="snow-art-shadow" cx="176" cy="174" rx="100" ry="13" />
          <circle className="snow-art-rim" cx="176" cy="102" r="78" fill="url(#daily-wheel-rim)" />
          <circle cx="176" cy="102" r="68" fill="url(#daily-wheel-face)" stroke="#bfefff" strokeWidth="3" />
          <g fill="none" strokeWidth="14">
            <circle cx="176" cy="102" r="58" stroke="#28c6d7" strokeDasharray="30 16" transform="rotate(-12 176 102)" />
            <circle cx="176" cy="102" r="58" stroke="#8159f3" strokeDasharray="14 32" transform="rotate(11 176 102)" />
            <circle cx="176" cy="102" r="58" stroke="#f0bf4e" strokeDasharray="7 39" transform="rotate(27 176 102)" />
          </g>
          <g className="snow-art-line" strokeWidth="2">
            <path d="M176 43v118M117 102h118M134 60l84 84M218 60l-84 84" />
          </g>
          <circle cx="176" cy="102" r="19" fill="#071329" stroke="#fff0a6" strokeWidth="5" />
          <path d="M176 14l15 22h-30z" fill="#fff0a6" stroke="#8b601e" strokeWidth="3" strokeLinejoin="round" />
          <g className="snow-art-spark" fill="#d9f8ff">
            <path d="M65 44l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" />
            <path d="M273 63l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
            <circle cx="78" cy="110" r="4" /><circle cx="276" cy="124" r="4" />
          </g>
        </svg>
      );
    case 'slots':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="slots-cabinet" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#9227bb" /><stop offset=".5" stopColor="#40105c" /><stop offset="1" stopColor="#150726" /></linearGradient>
            <linearGradient id="slots-gold" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff1a3" /><stop offset=".5" stopColor="#e2a92e" /><stop offset="1" stopColor="#8f5617" /></linearGradient>
          </defs>
          <ellipse className="snow-art-shadow" cx="169" cy="178" rx="112" ry="11" />
          <path d="M67 45q0-17 17-17h168q17 0 17 17v124H67z" fill="url(#slots-cabinet)" stroke="url(#slots-gold)" strokeWidth="6" strokeLinejoin="round" />
          <path d="M87 29h162l-13-17H101z" fill="url(#slots-gold)" stroke="#fff0a5" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="116" cy="21" r="4" fill="#4d174e" /><circle cx="220" cy="21" r="4" fill="#4d174e" />
          <rect x="82" y="57" width="172" height="83" rx="9" fill="#060d20" stroke="#ecbf55" strokeWidth="4" />
          <g>
            <rect x="91" y="66" width="47" height="65" rx="5" fill="#f4edf8" />
            <rect x="145" y="66" width="47" height="65" rx="5" fill="#f4edf8" />
            <rect x="199" y="66" width="46" height="65" rx="5" fill="#f4edf8" />
            <path d="M114 79c8-10 21-2 16 8-5 10-16 18-16 18s-11-8-16-18c-5-10 8-18 16-8z" fill="#e5355f" />
            <path d="M161 117l8-31 8 31M157 105h24" fill="none" stroke="#702d92" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M207 85h30l-20 33" fill="none" stroke="#df373d" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <path d="M73 147h190" stroke="#f0c75f" strokeWidth="4" />
          <rect x="126" y="151" width="86" height="18" rx="9" fill="url(#slots-gold)" />
          <path d="M275 62h12v63h-12zM281 54v-18" fill="none" stroke="#eabd50" strokeWidth="7" strokeLinecap="round" />
          <circle cx="281" cy="29" r="10" fill="#e54268" stroke="#fff0a5" strokeWidth="3" />
        </svg>
      );
    case 'blackjack':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="bj-felt" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#15915d" /><stop offset="1" stopColor="#063b2b" /></linearGradient>
            <linearGradient id="bj-chip" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffe8a1" /><stop offset="1" stopColor="#b8791e" /></linearGradient>
          </defs>
          <ellipse cx="175" cy="170" rx="130" ry="18" fill="url(#bj-felt)" stroke="#33cd91" strokeWidth="3" />
          <path d="M45 160c31-79 229-79 260 0" fill="none" stroke="#d0a84b" strokeWidth="5" />
          <g transform="translate(83 24) rotate(-12 58 78)">
            <rect width="100" height="142" rx="10" fill="#fffdfa" stroke="#d8e3ef" strokeWidth="4" />
            <text x="13" y="30" fill="#111b2e" fontSize="25" fontWeight="900" fontFamily="Arial, sans-serif">A</text>
            <path d="M25 53c-9 0-15-7-15-15 0-11 15-22 15-22s15 11 15 22c0 8-6 15-15 15zm-8 8h16l-5-13h-6z" fill="#111b2e" transform="translate(3 29) scale(.75)" />
            <path d="M50 49c-18 20-25 29-25 43 0 12 9 21 21 21 7 0 12-3 15-8-1 9-5 15-12 21h36c-7-6-11-12-12-21 3 5 8 8 15 8 12 0 21-9 21-21 0-14-7-23-25-43L67 28z" fill="#111b2e" transform="translate(-18 13) scale(.78)" />
          </g>
          <g transform="translate(158 19) rotate(10 58 78)">
            <rect width="100" height="142" rx="10" fill="#fffdfa" stroke="#d8e3ef" strokeWidth="4" />
            <text x="13" y="30" fill="#d72545" fontSize="25" fontWeight="900" fontFamily="Arial, sans-serif">K</text>
            <path d="M50 104C15 79 22 46 43 46c12 0 19 8 22 16 3-8 10-16 22-16 21 0 28 33-7 58l-15 11z" fill="#d72545" transform="translate(-6 -4) scale(.88)" />
          </g>
          <g>
            <circle cx="258" cy="153" r="25" fill="#0b2442" stroke="url(#bj-chip)" strokeWidth="7" strokeDasharray="8 5" />
            <circle cx="258" cy="153" r="12" fill="url(#bj-chip)" />
          </g>
        </svg>
      );
    case 'video-poker':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="vp-screen" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#176a9f" /><stop offset="1" stopColor="#071d42" /></linearGradient>
            <linearGradient id="vp-metal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d9f5ff" /><stop offset=".5" stopColor="#5596c9" /><stop offset="1" stopColor="#21456d" /></linearGradient>
          </defs>
          <path d="M36 38q0-15 15-15h226q15 0 15 15v117H36z" fill="url(#vp-screen)" stroke="url(#vp-metal)" strokeWidth="6" />
          <rect x="49" y="39" width="210" height="93" rx="7" fill="#071327" stroke="#4bbaf0" strokeWidth="2" />
          <g fontFamily="Arial, sans-serif" fontWeight="900" fontSize="18" textAnchor="middle">
            <g transform="translate(57 51) rotate(-5 18 31)"><rect width="37" height="58" rx="4" fill="#fff" /><text x="18" y="23" fill="#101827">10</text><text x="18" y="46" fill="#101827">♠</text></g>
            <g transform="translate(96 47) rotate(-2 18 31)"><rect width="37" height="58" rx="4" fill="#fff" /><text x="18" y="23" fill="#d92e4d">J</text><text x="18" y="46" fill="#d92e4d">♥</text></g>
            <g transform="translate(136 45)"><rect width="37" height="58" rx="4" fill="#fff" /><text x="18" y="23" fill="#101827">Q</text><text x="18" y="46" fill="#101827">♣</text></g>
            <g transform="translate(176 47) rotate(2 18 31)"><rect width="37" height="58" rx="4" fill="#fff" /><text x="18" y="23" fill="#d92e4d">K</text><text x="18" y="46" fill="#d92e4d">♦</text></g>
            <g transform="translate(215 51) rotate(5 18 31)"><rect width="37" height="58" rx="4" fill="#fff" /><text x="18" y="23" fill="#101827">A</text><text x="18" y="46" fill="#101827">♠</text></g>
          </g>
          <path d="M24 155h280l-18 28H42z" fill="url(#vp-metal)" stroke="#8fdcff" strokeWidth="3" strokeLinejoin="round" />
          <g fill="#10294a" stroke="#c7efff" strokeWidth="2"><rect x="62" y="161" width="35" height="12" rx="6" /><rect x="108" y="161" width="35" height="12" rx="6" /><rect x="154" y="161" width="35" height="12" rx="6" /><rect x="200" y="161" width="35" height="12" rx="6" /></g>
          <rect x="246" y="158" width="38" height="18" rx="9" fill="#efbd49" />
        </svg>
      );
    case 'roulette':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="roulette-rim" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffe497" /><stop offset=".45" stopColor="#ba7820" /><stop offset="1" stopColor="#66350d" /></linearGradient>
            <radialGradient id="roulette-bowl"><stop stopColor="#2a3449" /><stop offset=".65" stopColor="#0b1426" /><stop offset="1" stopColor="#040813" /></radialGradient>
          </defs>
          <ellipse className="snow-art-shadow" cx="164" cy="176" rx="128" ry="12" />
          <ellipse cx="164" cy="105" rx="132" ry="72" fill="url(#roulette-rim)" stroke="#ffe8a1" strokeWidth="3" />
          <ellipse cx="164" cy="101" rx="116" ry="58" fill="url(#roulette-bowl)" stroke="#522024" strokeWidth="12" strokeDasharray="18 9" />
          <ellipse cx="164" cy="101" rx="83" ry="39" fill="#7b1424" stroke="#dbb85f" strokeWidth="4" strokeDasharray="15 7" />
          <ellipse cx="164" cy="101" rx="55" ry="25" fill="#071529" stroke="#e0bc61" strokeWidth="4" />
          <path d="M164 57v88M83 101h162M105 72l118 58M105 130l118-58" fill="none" stroke="#e6be59" strokeWidth="2" opacity=".82" />
          <ellipse cx="164" cy="101" rx="22" ry="10" fill="url(#roulette-rim)" />
          <path d="M157 96h14l9 42h-32z" fill="url(#roulette-rim)" stroke="#ffe69b" strokeWidth="2" />
          <circle cx="223" cy="64" r="8" fill="#fff" stroke="#cbd8e7" strokeWidth="3" />
          <g fill="#ec3751"><circle cx="61" cy="52" r="8" /><circle cx="281" cy="82" r="5" /></g>
        </svg>
      );
    case 'plinko':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="plinko-frame" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff0a6" /><stop offset=".45" stopColor="#e2a933" /><stop offset="1" stopColor="#805018" /></linearGradient>
            <linearGradient id="plinko-board" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#173a68" /><stop offset="1" stopColor="#07142d" /></linearGradient>
            <radialGradient id="plinko-puck"><stop stopColor="#fff" /><stop offset=".35" stopColor="#8cf5ff" /><stop offset="1" stopColor="#149ebd" /></radialGradient>
          </defs>
          <ellipse className="snow-art-shadow" cx="174" cy="181" rx="124" ry="10" />
          <path d="M68 22h204l24 154H44z" fill="url(#plinko-board)" stroke="url(#plinko-frame)" strokeWidth="6" strokeLinejoin="round" />
          <path d="M91 43h158" stroke="#78def1" strokeWidth="2" opacity=".55" />
          <g fill="#f6d36e" stroke="#fff2b5" strokeWidth="1.5">
            <circle cx="170" cy="50" r="5" />
            <circle cx="145" cy="70" r="5" /><circle cx="195" cy="70" r="5" />
            <circle cx="120" cy="90" r="5" /><circle cx="170" cy="90" r="5" /><circle cx="220" cy="90" r="5" />
            <circle cx="95" cy="110" r="5" /><circle cx="145" cy="110" r="5" /><circle cx="195" cy="110" r="5" /><circle cx="245" cy="110" r="5" />
            <circle cx="70" cy="130" r="5" /><circle cx="120" cy="130" r="5" /><circle cx="170" cy="130" r="5" /><circle cx="220" cy="130" r="5" /><circle cx="270" cy="130" r="5" />
          </g>
          <circle cx="183" cy="78" r="11" fill="url(#plinko-puck)" stroke="#e9fdff" strokeWidth="3" />
          <path d="M60 145v27M97 145v30M134 145v33M170 145v34M206 145v33M243 145v30M280 145v27" stroke="#d8b450" strokeWidth="4" />
          <g fontFamily="Arial, sans-serif" fontWeight="900" fontSize="11" textAnchor="middle">
            <text x="78" y="164" fill="#8feaff">10</text><text x="115" y="166" fill="#fff0a1">25</text><text x="152" y="169" fill="#f3a7ff">50</text>
            <text x="188" y="169" fill="#fff">100</text><text x="225" y="166" fill="#f3a7ff">50</text><text x="262" y="164" fill="#8feaff">10</text>
          </g>
        </svg>
      );
    case 'tv-trivia':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="trivia-screen" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#50258f" /><stop offset=".58" stopColor="#24124f" /><stop offset="1" stopColor="#0b1534" /></linearGradient>
            <linearGradient id="trivia-trim" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8c8ff" /><stop offset=".52" stopColor="#9a67e9" /><stop offset="1" stopColor="#4b2b8f" /></linearGradient>
          </defs>
          <ellipse className="snow-art-shadow" cx="170" cy="181" rx="128" ry="10" />
          <rect x="35" y="22" width="270" height="145" rx="17" fill="url(#trivia-screen)" stroke="url(#trivia-trim)" strokeWidth="6" />
          <path d="M55 48h230" stroke="#dca8ff" strokeWidth="2" opacity=".45" />
          <circle cx="170" cy="79" r="37" fill="#0a1838" stroke="#ffd66f" strokeWidth="4" />
          <text x="170" y="96" fill="#fff" fontSize="51" fontWeight="900" textAnchor="middle" fontFamily="Arial, sans-serif">?</text>
          <g strokeWidth="2">
            <rect x="57" y="126" width="51" height="25" rx="8" fill="#123d76" stroke="#70c6ff" />
            <rect x="116" y="126" width="51" height="25" rx="8" fill="#60246d" stroke="#ec8cff" />
            <rect x="175" y="126" width="51" height="25" rx="8" fill="#624719" stroke="#ffda76" />
            <rect x="234" y="126" width="51" height="25" rx="8" fill="#15594b" stroke="#73f2c6" />
          </g>
          <g fill="#fff" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="12" textAnchor="middle"><text x="82" y="143">A</text><text x="141" y="143">B</text><text x="200" y="143">C</text><text x="259" y="143">D</text></g>
          <path d="M65 31l5 12 12 5-12 5-5 12-5-12-12-5 12-5zM278 50l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#ffe685" />
          <path d="M140 168h60l14 13h-88z" fill="#7547ad" stroke="#e3bbff" strokeWidth="3" />
        </svg>
      );
    case 'dice-lounge':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="dice-felt" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#17628e" /><stop offset="1" stopColor="#092442" /></linearGradient>
            <linearGradient id="dice-gold" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff0a7" /><stop offset=".48" stopColor="#d9a43a" /><stop offset="1" stopColor="#734317" /></linearGradient>
          </defs>
          <ellipse cx="170" cy="145" rx="145" ry="45" fill="url(#dice-felt)" stroke="url(#dice-gold)" strokeWidth="5" />
          <ellipse cx="170" cy="145" rx="124" ry="30" fill="none" stroke="#73c9ef" strokeWidth="2" opacity=".7" />
          <g transform="translate(66 50) rotate(-10 43 43)">
            <rect width="86" height="86" rx="15" fill="#f8fbff" stroke="#b8d5ea" strokeWidth="4" />
            <g fill="#13243e"><circle cx="23" cy="23" r="8" /><circle cx="63" cy="23" r="8" /><circle cx="43" cy="43" r="8" /><circle cx="23" cy="63" r="8" /><circle cx="63" cy="63" r="8" /></g>
          </g>
          <g transform="translate(151 39) rotate(8 43 43)">
            <rect width="86" height="86" rx="15" fill="#fff7e9" stroke="#ead0a3" strokeWidth="4" />
            <g fill="#d43853"><circle cx="23" cy="23" r="8" /><circle cx="63" cy="23" r="8" /><circle cx="23" cy="63" r="8" /><circle cx="63" cy="63" r="8" /></g>
          </g>
          <g transform="translate(218 77) rotate(16 34 34)">
            <rect width="68" height="68" rx="13" fill="#eafaff" stroke="#8fd6ef" strokeWidth="4" />
            <g fill="#153451"><circle cx="20" cy="20" r="7" /><circle cx="48" cy="48" r="7" /></g>
          </g>
          <g fill="#f9dc7a"><circle cx="48" cy="54" r="5" /><circle cx="278" cy="44" r="4" /><path d="M283 119l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" /></g>
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="holdem-felt" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#159b8e" /><stop offset="1" stopColor="#063f47" /></linearGradient>
            <linearGradient id="holdem-gold" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffe9a0" /><stop offset="1" stopColor="#b5791f" /></linearGradient>
          </defs>
          <ellipse cx="167" cy="108" rx="139" ry="68" fill="url(#holdem-felt)" stroke="#56dcc8" strokeWidth="4" />
          <ellipse cx="167" cy="108" rx="119" ry="51" fill="none" stroke="#d9b85e" strokeWidth="2" />
          <g fontFamily="Arial, sans-serif" fontWeight="900" fontSize="16" textAnchor="middle">
            <g transform="translate(73 75) rotate(-5 20 30)"><rect width="40" height="60" rx="4" fill="#fff" /><text x="20" y="23" fill="#111827">10</text><text x="20" y="45" fill="#111827">♣</text></g>
            <g transform="translate(113 69) rotate(-2 20 30)"><rect width="40" height="60" rx="4" fill="#fff" /><text x="20" y="23" fill="#d52a49">J</text><text x="20" y="45" fill="#d52a49">♦</text></g>
            <g transform="translate(153 67)"><rect width="40" height="60" rx="4" fill="#fff" /><text x="20" y="23" fill="#111827">Q</text><text x="20" y="45" fill="#111827">♠</text></g>
            <g transform="translate(193 69) rotate(2 20 30)"><rect width="40" height="60" rx="4" fill="#fff" /><text x="20" y="23" fill="#d52a49">K</text><text x="20" y="45" fill="#d52a49">♥</text></g>
            <g transform="translate(233 75) rotate(5 20 30)"><rect width="40" height="60" rx="4" fill="#fff" /><text x="20" y="23" fill="#111827">A</text><text x="20" y="45" fill="#111827">♣</text></g>
          </g>
          <g transform="translate(106 18) rotate(-10 29 43)"><rect width="58" height="85" rx="7" fill="#fff" stroke="#dbe5ef" strokeWidth="3" /><text x="12" y="24" fill="#111827" fontSize="21" fontWeight="900" fontFamily="Arial, sans-serif">A</text><path d="M29 35c-11 12-16 19-16 28 0 8 6 14 14 14 4 0 8-2 10-5-1 6-3 10-8 14h24c-5-4-7-8-8-14 2 3 6 5 10 5 8 0 14-6 14-14 0-9-5-16-16-28L41 22z" transform="translate(1 4) scale(.68)" fill="#111827" /></g>
          <g transform="translate(158 13) rotate(8 29 43)"><rect width="58" height="85" rx="7" fill="#fff" stroke="#dbe5ef" strokeWidth="3" /><text x="12" y="24" fill="#d52a49" fontSize="21" fontWeight="900" fontFamily="Arial, sans-serif">K</text><path d="M29 64C5 47 10 25 25 25c8 0 13 5 15 11 2-6 7-11 15-11 15 0 20 22-4 39L40 72z" fill="#d52a49" transform="translate(0 4) scale(.72)" /></g>
          <g><circle cx="48" cy="151" r="21" fill="#092145" stroke="url(#holdem-gold)" strokeWidth="6" strokeDasharray="7 4" /><circle cx="48" cy="151" r="9" fill="#e3b74f" /></g>
        </svg>
      );
  }
};
