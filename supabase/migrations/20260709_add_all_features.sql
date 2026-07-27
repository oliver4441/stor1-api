-- Migration: Add all e-commerce features (delivery zones, pickup stations,
-- product Q&A, wholesale pricing, seller marketplace, return requests)
-- Run this in Supabase SQL Editor or via exec_sql

-- ============================================================
-- 1. DELIVERY ZONES & ESTIMATES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  estimated_days_min INTEGER NOT NULL DEFAULT 1,
  estimated_days_max INTEGER NOT NULL DEFAULT 3,
  delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  free_delivery_threshold DECIMAL(10, 2) DEFAULT NULL, -- orders above this get free delivery
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Kericho delivery zones
INSERT INTO public.delivery_zones (zone_name, display_name, estimated_days_min, estimated_days_max, delivery_fee, free_delivery_threshold, sort_order) VALUES
  ('kericho_cbd', 'Kericho CBD', 0, 0, 0, NULL, 1),
  ('kericho_town', 'Kericho Town', 1, 2, 0, NULL, 2),
  ('kericho_surrounding', 'Kericho Surrounding', 1, 2, 100, 2000, 3),
  ('litein', 'Litein', 1, 2, 100, 2000, 4),
  ('kipkelion', 'Kipkelion', 2, 3, 150, 2500, 5),
  ('londiani', 'Londiani', 2, 3, 150, 2500, 6),
  ('brooke', 'Brooke', 2, 3, 150, 2500, 7),
  ('sosiot', 'Sosiot', 2, 3, 150, 2500, 8),
  ('fort_ternan', 'Fort Ternan', 2, 3, 200, 3000, 9),
  ('outside_kericho', 'Outside Kericho', 3, 5, 300, 5000, 10)
ON CONFLICT (zone_name) DO NOTHING;

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view delivery zones" ON public.delivery_zones;
CREATE POLICY "Anyone can view delivery zones"
  ON public.delivery_zones FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage delivery zones" ON public.delivery_zones;
CREATE POLICY "Admins can manage delivery zones"
  ON public.delivery_zones FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Add delivery_zone_id to omix_orders
ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_zone_id UUID REFERENCES public.delivery_zones(id);
ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_estimate_min INTEGER DEFAULT NULL;
ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_estimate_max INTEGER DEFAULT NULL;

-- ============================================================
-- 2. PICK-UP STATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pickup_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT,
  landmark TEXT,
  latitude DECIMAL(10, 7) DEFAULT NULL,
  longitude DECIMAL(10, 7) DEFAULT NULL,
  operating_hours TEXT DEFAULT 'Mon-Sat 8AM-6PM',
  contact_phone TEXT DEFAULT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Kericho pickup stations
INSERT INTO public.pickup_stations (name, area, address, landmark, sort_order) VALUES
  ('Omix Store - CBD', 'Kericho CBD', 'Kericho Town, Opposite Post Bank', 'Next to Kericho Post Office', 1),
  ('Omix Store - Litein', 'Litein', 'Litein Shopping Centre', 'Opposite Litein Market', 2),
  ('Omix Store - Brooke', 'Brooke', 'Brooke Market Area', 'Near Brooke Tea Factory', 3),
  ('Omix Store - Sosiot', 'Sosiot', 'Sosiot Town Centre', 'Next to Sosiot Stage', 4),
  ('Omix Store - Kipkelion', 'Kipkelion', 'Kipkelion Town', 'Near Kipkelion Market', 5)
ON CONFLICT (name, area) DO NOTHING;

-- Add unique constraint to prevent duplicate pickup stations
ALTER TABLE public.pickup_stations ADD CONSTRAINT unique_pickup_station UNIQUE (name, area);

ALTER TABLE public.pickup_stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view pickup stations" ON public.pickup_stations;
CREATE POLICY "Anyone can view pickup stations"
  ON public.pickup_stations FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage pickup stations" ON public.pickup_stations;
CREATE POLICY "Admins can manage pickup stations"
  ON public.pickup_stations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Add pickup_station_id to omix_orders
ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS pickup_station_id UUID REFERENCES public.pickup_stations(id);
ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'delivery' CHECK (delivery_type IN ('delivery', 'pickup'));

-- ============================================================
-- 3. PRODUCT QUESTIONS & ANSWERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT DEFAULT NULL,
  answered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view product questions" ON public.product_questions;
CREATE POLICY "Anyone can view product questions"
  ON public.product_questions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own questions" ON public.product_questions;
CREATE POLICY "Users can insert own questions"
  ON public.product_questions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own questions" ON public.product_questions;
CREATE POLICY "Users can delete own questions"
  ON public.product_questions FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can answer questions" ON public.product_questions;
CREATE POLICY "Admins can answer questions"
  ON public.product_questions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_product_questions_listing_id ON public.product_questions(listing_id);

-- ============================================================
-- 4. WHOLESALE / BULK PRICING
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wholesale_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
  max_quantity INTEGER DEFAULT NULL, -- NULL = unlimited
  unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_listing_tier UNIQUE (listing_id, min_quantity)
);

ALTER TABLE public.wholesale_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view wholesale prices" ON public.wholesale_prices;
CREATE POLICY "Anyone can view wholesale prices"
  ON public.wholesale_prices FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage wholesale prices" ON public.wholesale_prices;
CREATE POLICY "Admins can manage wholesale prices"
  ON public.wholesale_prices FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_wholesale_prices_listing_id ON public.wholesale_prices(listing_id);

-- Add wholesale flag to listings
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS wholesale_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS wholesale_min_qty INTEGER DEFAULT NULL;

-- ============================================================
-- 5. SELLER / MULTI-VENDOR MARKETPLACE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  shop_name TEXT NOT NULL,
  shop_slug TEXT UNIQUE NOT NULL,
  shop_description TEXT,
  shop_logo TEXT,
  shop_banner TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  business_registration TEXT,
  commission_rate DECIMAL(4, 4) DEFAULT 0.0500, -- 5% default
  total_sales DECIMAL(12, 2) DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  rating DECIMAL(3, 2) DEFAULT 0,
  seller_score DECIMAL(4, 1) DEFAULT 100.0, -- 0-100 seller score
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view sellers" ON public.sellers;
CREATE POLICY "Anyone can view sellers"
  ON public.sellers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can register as seller" ON public.sellers;
CREATE POLICY "Users can register as seller"
  ON public.sellers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Sellers can update own profile" ON public.sellers;
CREATE POLICY "Sellers can update own profile"
  ON public.sellers FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage sellers" ON public.sellers;
CREATE POLICY "Admins can manage sellers"
  ON public.sellers FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seller payout accounts
CREATE TABLE IF NOT EXISTS public.seller_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  paid_at TIMESTAMPTZ DEFAULT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers can view own payouts" ON public.seller_payouts;
CREATE POLICY "Sellers can view own payouts"
  ON public.seller_payouts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_payouts.seller_id AND user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage seller payouts" ON public.seller_payouts;
CREATE POLICY "Admins can manage seller payouts"
  ON public.seller_payouts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Add seller info to listings
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id);
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS is_wholesale BOOLEAN DEFAULT false;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS min_wholesale_qty INTEGER DEFAULT NULL;

-- Add seller_id to omix_orders (for tracking which seller gets the order)
ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id);

-- ============================================================
-- 6. RETURN REQUESTS (Inspect at delivery)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.omix_orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES public.omix_order_items(id),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'collected', 'refunded', 'rejected')),
  refund_amount DECIMAL(12, 2) DEFAULT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.return_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own returns" ON public.return_requests;
CREATE POLICY "Users can view own returns"
  ON public.return_requests FOR SELECT
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Users can create return requests" ON public.return_requests;
CREATE POLICY "Users can create return requests"
  ON public.return_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage returns" ON public.return_requests;
CREATE POLICY "Admins can manage returns"
  ON public.return_requests FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_return_requests_order_id ON public.return_requests(order_id);

-- ============================================================
-- 7. Add rating columns to listings (cache for performance)
-- ============================================================
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3, 2) DEFAULT NULL;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;

-- Create or replace function to update listing rating cache
CREATE OR REPLACE FUNCTION public.update_listing_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.listings
  SET
    avg_rating = (SELECT ROUND(AVG(rating::decimal), 2) FROM public.product_reviews WHERE listing_id = COALESCE(NEW.listing_id, OLD.listing_id)),
    review_count = (SELECT COUNT(*) FROM public.product_reviews WHERE listing_id = COALESCE(NEW.listing_id, OLD.listing_id))
  WHERE id = COALESCE(NEW.listing_id, OLD.listing_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_listing_rating_insert ON public.product_reviews;
CREATE TRIGGER trg_update_listing_rating_insert
  AFTER INSERT ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_listing_rating();

DROP TRIGGER IF EXISTS trg_update_listing_rating_update ON public.product_reviews;
CREATE TRIGGER trg_update_listing_rating_update
  AFTER UPDATE OF rating ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_listing_rating();

DROP TRIGGER IF EXISTS trg_update_listing_rating_delete ON public.product_reviews;
CREATE TRIGGER trg_update_listing_rating_delete
  AFTER DELETE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_listing_rating();

-- Backfill existing ratings
UPDATE public.listings l
SET
  avg_rating = (SELECT ROUND(AVG(rating::decimal), 2) FROM public.product_reviews WHERE listing_id = l.id),
  review_count = (SELECT COUNT(*) FROM public.product_reviews WHERE listing_id = l.id);

-- ============================================================
-- 8. Add delivery fee column to orders (was missing)
-- ============================================================
ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10, 2) DEFAULT 0;

-- ============================================================
-- 9. Indexes for search performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_listings_avg_rating ON public.listings(avg_rating);
CREATE INDEX IF NOT EXISTS idx_listings_review_count ON public.listings(review_count);
CREATE INDEX IF NOT EXISTS idx_listings_wholesale ON public.listings(wholesale_enabled) WHERE wholesale_enabled = true;
CREATE INDEX IF NOT EXISTS idx_omix_orders_delivery_type ON public.omix_orders(delivery_type);

-- ============================================================
-- 10. Grant permissions
-- ============================================================
GRANT ALL ON public.delivery_zones TO anon, authenticated, service_role;
GRANT ALL ON public.pickup_stations TO anon, authenticated, service_role;
GRANT ALL ON public.product_questions TO anon, authenticated, service_role;
GRANT ALL ON public.wholesale_prices TO anon, authenticated, service_role;
GRANT ALL ON public.sellers TO anon, authenticated, service_role;
GRANT ALL ON public.seller_payouts TO anon, authenticated, service_role;
GRANT ALL ON public.return_requests TO anon, authenticated, service_role;
