import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Use from Route Handlers or Server Actions when writing authentication cookies.
// A complete sign-in flow also needs the token-refresh proxy described in Supabase's docs.
export async function createClient() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured. Run the setup command.');
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: values => { for (const { name, value, options } of values) store.set(name, value, options); },
    },
  });
}
