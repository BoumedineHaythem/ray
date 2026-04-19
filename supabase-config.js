// ============================================
//  EV Fleet Manager — Supabase Configuration
// ============================================
//  SETUP (5 minutes):
//  1. Go to https://supabase.com → Create free project
//  2. Go to SQL Editor → Run the SQL from README.md
//  3. Go to Settings → API
//  4. Copy "Project URL" and "anon/public" key
//  5. Paste below, save, re-deploy to GitHub Pages
// ============================================

const SUPABASE_URL      = 'https://omxrqlmeovvnipktpayb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_n4IxibvfhPsy8b-OMDkZFQ_nY0fTzAg';

// Auto-detected: false = offline mode (localStorage only)
const USE_SUPABASE = !SUPABASE_URL.includes('YOUR_PROJECT_ID')
                  && SUPABASE_ANON_KEY.length > 20;
