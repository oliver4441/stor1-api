const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');

const creds = JSON.parse(readFileSync('/root/.supabase_creds.json', 'utf-8'));
const supabase = createClient('https://fdwoezyataxhdtgjlfxt.supabase.co', creds.service_key);

async function runSql(sql) {
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) console.error('Error:', error.message);
  return !error;
}

async function main() {
  // Enable RLS
  await runSql('ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY');

  // Drop existing policies to recreate
  await runSql('DROP POLICY IF EXISTS "Anyone can read reviews" ON public.product_reviews');
  await runSql('DROP POLICY IF EXISTS "Authenticated users can create reviews" ON public.product_reviews');
  await runSql('DROP POLICY IF EXISTS "Users can update own reviews" ON public.product_reviews');
  await runSql('DROP POLICY IF EXISTS "Admins can manage all reviews" ON public.product_reviews');

  // Policies
  await runSql(`
    CREATE POLICY "Anyone can read reviews" ON public.product_reviews
    FOR SELECT USING (true)
  `);
  await runSql(`
    CREATE POLICY "Authenticated users can create reviews" ON public.product_reviews
    FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid())
  `);
  await runSql(`
    CREATE POLICY "Users can update own reviews" ON public.product_reviews
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid())
  `);
  await runSql(`
    CREATE POLICY "Admins can manage all reviews" ON public.product_reviews
    FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  `);

  // Grant permissions
  await runSql('GRANT ALL ON public.product_reviews TO anon, authenticated, service_role');

  console.log('Done! RLS policies set for product_reviews.');
}

main().catch(console.error);
