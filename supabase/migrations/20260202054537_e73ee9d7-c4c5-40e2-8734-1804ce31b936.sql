-- Fix VibezTV icon URL to use correct filename
UPDATE public.apps 
SET icon_url = '/icons/vibez.png', updated_at = now()
WHERE name = 'VibezTV';