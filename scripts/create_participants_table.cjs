const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');

const creds = JSON.parse(readFileSync('/root/.supabase_creds.json', 'utf-8'));
const supabaseUrl = 'https://fdwoezyataxhdtgjlfxt.supabase.co';
const supabase = createClient(supabaseUrl, creds.service_key);

async function runSql(sql) {
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) console.error('Error:', error.message);
  return !error;
}

async function main() {
  console.log('=== Creating conversation_participants table ===');
  await runSql(`
    CREATE TABLE IF NOT EXISTS public.conversation_participants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      last_read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(conversation_id, user_id)
    )
  `);

  console.log('=== Creating indexes ===');
  await runSql('CREATE INDEX IF NOT EXISTS idx_cp_conversation ON public.conversation_participants(conversation_id)');
  await runSql('CREATE INDEX IF NOT EXISTS idx_cp_user ON public.conversation_participants(user_id)');
  await runSql('CREATE INDEX IF NOT EXISTS idx_cp_unread ON public.conversation_participants(user_id, conversation_id, last_read_at)');

  console.log('=== Enabling RLS ===');
  await runSql('ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY');

  console.log('=== Creating RLS policies ===');
  await runSql(`DROP POLICY IF EXISTS "Users can view own participation" ON public.conversation_participants`);
  await runSql(`
    CREATE POLICY "Users can view own participation" ON public.conversation_participants
    FOR SELECT USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  `);
  await runSql(`DROP POLICY IF EXISTS "Users can update own read time" ON public.conversation_participants`);
  await runSql(`
    CREATE POLICY "Users can update own read time" ON public.conversation_participants
    FOR UPDATE USING (user_id = auth.uid())
  `);
  await runSql(`DROP POLICY IF EXISTS "System can insert participants" ON public.conversation_participants`);
  await runSql(`
    CREATE POLICY "System can insert participants" ON public.conversation_participants
    FOR INSERT WITH CHECK (true)
  `);

  console.log('=== Granting permissions ===');
  await runSql('GRANT ALL ON public.conversation_participants TO anon, authenticated, service_role');

  console.log('=== Adding to realtime publication ===');
  await runSql("ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants");

  console.log('\n=== Verifying ===');
  const { data } = await supabase.rpc('exec_sql', {
    sql: "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('conversations','messages','conversation_participants')"
  });
  console.log('Tables:', JSON.stringify(data));

  console.log('\n=== Done! ===');
}

main().catch(console.error);
