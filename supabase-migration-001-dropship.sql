-- Run in Supabase SQL editor when service_role key is available
ALTER TABLE listings ADD COLUMN IF NOT EXISTS supplier TEXT DEFAULT 'local';
