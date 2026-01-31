-- Update download URLs from IP address to domain name
UPDATE public.apps 
SET download_url = REPLACE(download_url, '104.168.147.178', 'snowmediaapps.com') 
WHERE download_url LIKE '%104.168.147.178%';