# Re-enable the scrolling RSS ticker on low-memory devices

The news ticker's scrolling animation is being killed at startup on Android TV / Fire TV / older STBs by the `.native-low-memory` CSS class added during the earlier crash-mitigation pass. The ticker still renders, but the text sits frozen, so it looks "off".

## Fix

In `src/index.css`, drop `.news-ticker-track` from the `.native-low-memory` animation-disabling rule so the RSS marquee scrolls on every device at startup. (Keep the same rule for `.media-bar-track`, since the Content Bar uses its own auto-rotate timer and doesn't need the CSS marquee.)

Before:
```css
.native-low-memory .news-ticker-track,
.native-low-memory .media-bar-track {
  animation: none !important;
  transform: none !important;
}
```

After:
```css
.native-low-memory .media-bar-track {
  animation: none !important;
  transform: none !important;
}
```

The existing `prefers-reduced-motion` guard is left intact so users with that OS setting still get a stopped ticker.

No other files change.
