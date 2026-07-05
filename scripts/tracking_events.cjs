const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');

const creds = JSON.parse(readFileSync('/root/.supabase_creds.json', 'utf-8'));
const supabaseUrl = 'https://fdwoezyataxhdtgjlfxt.supabase.co';
const supabase = createClient(supabaseUrl, creds.service_key);

async function runSql(sql) {
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) console.error('Error:', error.message);
  return { data, error };
}

async function main() {
  console.log('=== Creating tracking_events table ===');
  await runSql(`
    CREATE TABLE IF NOT EXISTS public.tracking_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES omix_orders(id) ON DELETE CASCADE,
      status text NOT NULL,
      note text,
      created_at timestamptz DEFAULT now()
    )
  `);

  console.log('=== Creating index ===');
  await runSql('CREATE INDEX IF NOT EXISTS idx_tracking_events_order ON public.tracking_events(order_id)');

  console.log('=== Enabling RLS ===');
  await runSql('ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY');

  console.log('=== Policies ===');
  // Drop existing policies first
  await runSql('DROP POLICY IF EXISTS "Anyone can read tracking events" ON public.tracking_events');
  await runSql('DROP POLICY IF EXISTS "Admins can insert tracking events" ON public.tracking_events');
  await runSql('DROP POLICY IF EXISTS "Admins can update tracking events" ON public.tracking_events');

  const policies = [
    `CREATE POLICY "Anyone can read tracking events" ON public.tracking_events
      FOR SELECT USING (true)`,
    `CREATE POLICY "Admins can insert tracking events" ON public.tracking_events
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can update tracking events" ON public.tracking_events
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
  ];

  for (const p of policies) {
    const name = p.split('"')[1];
    const { error } = await runSql(p);
    console.log(`Policy "${name}": ${error ? 'FAILED: ' + error.message : 'OK'}`);
  }

  console.log('=== Grants ===');
  await runSql('GRANT ALL ON public.tracking_events TO anon, authenticated, service_role');

  console.log('=== Realtime publication ===');
  const { error: pubErr } = await runSql(
    'ALTER PUBLICATION supabase_realtime ADD TABLE tracking_events'
  );
  if (pubErr) {
    // Ignore "already a member" errors — common on re-runs
    if (pubErr.message.includes('already a member')) {
      console.log('Publication: already added (OK)');
    } else {
      console.log('Publication add warning (non-fatal):', pubErr.message);
    }
  }

  console.log('\n=== Final Verification ===');
  const { data: tables } = await runSql(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('tracking_events')"
  );
  console.log('Tables:', JSON.stringify(tables));
}

main().catch(console.error);
