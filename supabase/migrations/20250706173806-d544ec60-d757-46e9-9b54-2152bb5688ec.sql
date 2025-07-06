-- Create apps table for Snow Media Center
CREATE TABLE public.apps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  size TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Main',
  icon_url TEXT,
  download_url TEXT,
  is_installed BOOLEAN DEFAULT false,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;

-- Create policy to allow everyone to read apps (public access)
CREATE POLICY "Anyone can view apps" 
ON public.apps 
FOR SELECT 
USING (true);

-- Create policy to allow authenticated users to manage apps (for admin)
CREATE POLICY "Authenticated users can manage apps" 
ON public.apps 
FOR ALL 
USING (auth.role() = 'authenticated');

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_apps_updated_at
BEFORE UPDATE ON public.apps
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert sample apps data
INSERT INTO public.apps (name, description, size, category, icon_url, download_url, is_installed, is_featured) VALUES
('Dreamstreams', 'Premium streaming service', '45.2 MB', 'Main', '/icons/dreamstreams.png', '104.168.147.178/apps/dreamstreams.apk', true, true),
('VibezTV', 'Live TV streaming', '38.6 MB', 'Main', '/icons/vibeztv.png', '104.168.147.178/apps/vibeztv.apk', false, true),
('Plex', 'Media streaming platform', '52.3 MB', 'Main', '/icons/plex.png', '104.168.147.178/apps/plex.apk', true, true),
('Cinema HD', 'Premium streaming application', '25.6 MB', 'Main', '/icons/cinemahd.png', '104.168.147.178/apps/cinemahd.apk', false, true),
('IPVanish', 'VPN security & privacy', '18.9 MB', 'Main', '/icons/ipvanish.png', '104.168.147.178/apps/ipvanish.apk', true, true),
('Stremio', 'Media center for video content', '89.2 MB', 'Media', '/icons/stremio.png', '104.168.147.178/apps/stremio.apk', false, false),
('Kodi', 'Open source media center', '75.4 MB', 'Media', '/icons/kodi.png', '104.168.147.178/apps/kodi.apk', false, false),
('Tivimate', 'IPTV player application', '12.8 MB', 'IPTV', '/icons/tivimate.png', '104.168.147.178/apps/tivimate.apk', false, false);