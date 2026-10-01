import { memo, useState } from 'react';
import { Tv } from 'lucide-react';
import { channelInitials } from '@/lib/channelInitials';

/**
 * The picture on a Home channel tile. The initials badge is always there, on
 * the app's dark card; the logo goes over it and only takes its place once it
 * has loaded. So a missing, slow, blocked (http on https), 404 or zero-size
 * logo leaves the badge, never an empty box, and a logo drawn in white sits on
 * a dark card instead of a white one.
 */
const ChannelArt = memo(({ name, src }: { name?: string; src?: string }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const initials = channelInitials(name);
  const showLogo = !!src && !failed;
  return (
    <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-black/40" data-testid="channel-art">
      {!(showLogo && loaded) && (
        <div
          className="flex items-center justify-center rounded-full bg-white/10 text-white/85 font-bold text-2xl w-14 h-14"
          data-testid="channel-initials"
          aria-hidden="true"
        >
          {initials || <Tv className="w-7 h-7 text-white/60" />}
        </div>
      )}
      {showLogo && (
        <img
          src={src}
          alt=""
          decoding="async"
          className="absolute top-0 left-0 right-0 bottom-0 m-auto max-w-[80%] max-h-[70%] object-contain"
          style={loaded ? undefined : { opacity: 0 }}
          onLoad={(e) => {
            // A 0x0 "image" (empty body, transparent stub) is no logo.
            if (e.currentTarget.naturalWidth === 0) setFailed(true); else setLoaded(true);
          }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
});
ChannelArt.displayName = 'ChannelArt';

export default ChannelArt;
