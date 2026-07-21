-- ============================================================
-- M7: Achievements / Gamification system
-- ============================================================

-- 1. Achievement definitions (seeded)
CREATE TABLE IF NOT EXISTS public.achievements (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,            -- machine-readable key
    name VARCHAR(100) NOT NULL,                  -- 'First Sale'
    description TEXT NOT NULL,                    -- 'Refer and convert your first customer'
    icon VARCHAR(50) NOT NULL DEFAULT 'star',    -- icon identifier
    category VARCHAR(30) NOT NULL DEFAULT 'sales', -- sales | referrals | earnings | tier | social
    criteria_type VARCHAR(30) NOT NULL,           -- converted_referrals | total_sales | commission_earned | tier_reached | leaderboard_rank
    criteria_value NUMERIC NOT NULL DEFAULT 1,    -- threshold value
    tier VARCHAR(20) NOT NULL DEFAULT 'bronze'    -- bronze | silver | gold | platinum
);

-- 2. User achievements (earned)
CREATE TABLE IF NOT EXISTS public.user_achievements (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_id INTEGER NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notified BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id, achievement_id)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON public.user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_achievements_category ON public.achievements(category);

-- 4. Seed default achievements
INSERT INTO public.achievements (code, name, description, icon, category, criteria_type, criteria_value, tier)
VALUES
    ('first-sale',       'First Sale',       'Refer and convert your first customer',          'zap',      'sales',      'converted_referrals', 1,    'bronze'),
    ('five-sales',       'Five Sales',       'Convert 5 customers through your referral link', 'zap',      'sales',      'converted_referrals', 5,    'silver'),
    ('ten-sales',        'Ten Sales',        'Convert 10 loyal customers',                     'zap',      'sales',      'converted_referrals', 10,   'gold'),
    ('first-earnings',   'First Earnings',   'Earn your first commission payout',              'coin',     'earnings',   'commission_earned',    1,    'bronze'),
    ('big-earner',       'Big Earner',       'Earn KSh 5,000 in total commission',             'coin',     'earnings',   'commission_earned',    5000, 'silver'),
    ('top-earner',       'Top Earner',       'Earn KSh 20,000 in total commission',            'coin',     'earnings',   'commission_earned',    20000,'gold'),
    ('gold-tier',        'Gold Status',      'Reach Gold affiliate tier',                      'award',    'tier',       'tier_reached',         2,    'gold'),
    ('big-spender',      'Big Spender',      'Refer a customer who spends KSh 10,000+',        'target',   'sales',      'single_order_value',   10000,'silver'),
    ('referral-pro',     'Referral Pro',     'Get 50 people to click your referral link',      'users',    'referrals',  'total_clicks',         50,   'silver'),
    ('viral',            'Going Viral',      'Get 500 referral link clicks',                   'users',    'referrals',  'total_clicks',         500,  'gold'),
    ('first-payout',     'First Payout',     'Complete your first payout withdrawal',          'wallet',   'earnings',   'payout_completed',     1,    'bronze'),
    ('top-performer',    'Top Performer',    'Reach #1 on the leaderboard',                    'trophy',   'social',     'leaderboard_rank',     1,    'platinum')
ON CONFLICT (code) DO NOTHING;
