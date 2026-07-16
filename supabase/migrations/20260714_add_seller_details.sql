-- Migration: Add seller onboarding detail columns
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS kra_pin TEXT;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS id_number TEXT;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS mpesa_phone TEXT;
