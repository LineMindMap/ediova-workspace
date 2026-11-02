# Ediova Inc. — Workspace

A React, TypeScript and Vite website for Ediova Inc., with an authenticated task workspace powered by Supabase.

## What's included

- Green-gradient Ediova logo and blended green/lime palette with a small orange accent.
- Animated landing page and a 2-second logo transition when entering login.
- No role picker on login. Supabase assigns role access from the signed-in profile.
- Login supports browser autofill, browser-persisted Supabase sessions, and clear inline sign-in feedback. On a trusted computer, a valid session opens the existing workspace directly; users should sign out on shared computers.
- Manager and Managing Director task views, a compact today-only task dashboard, role-aware task details, comments, resources and calendar. The Managing Director alone can delete tasks and can release a task immediately with Start now.
- Recurring tasks: daily, weekly on selected weekdays (every 1 or 2 weeks), and monthly on selected calendar dates. Blank end dates mean an ongoing series. Occurrences are generated within the current calendar month and continue into each new month. Weekly repeats default to 12:00 AM Pakistan time.
- Completed work is moved out of active tasks. The Director can reopen completed tasks.
- A seven-person team directory popup.
- A company-notice tool for the Managing Director; the latest active notice appears at the top of dashboards.
- Performance: monthly totals and a selectable calendar for daily completed-task counts and credited hours, plus the existing late-task score (minus 10 points for every full 24 hours late, minimum 0). The Managing Director manually assigns hours to each task. Task-level hour targets are stored separately and visible only to the Managing Director; Managers see monthly and daily totals, not individual targets. Credited hours are task allocations, not stopwatch-tracked time.
- Asia/Karachi (UTC+05:00) display and scheduling.
- Supabase row-level security, a recurring-task generator scheduled hourly, security headers, organization metadata, robots.txt and sitemap.xml.

## Team directory

1. Hamza Mubarak — Managing Director — Yogyakarta, Indonesia
2. Humna Haroon — Manager — Islamabad, Pakistan
3. Syed Shaheer — Senior Video Editor — Faisalabad, Pakistan
4. Muhammad Hammad — Anime Expert — Aceh, Indonesia
5. Ahmer Munir — Truvision Studio — Hafizabad, Pakistan
6. Ahmer Khan — Junior Video Editor — Karachi, Pakistan
7. Salman Asghar — Journal Writing — Sialkot, Pakistan

The first two people are linked to the existing Supabase Auth profiles. The other five are directory entries only; create Auth accounts and provision roles separately before allowing them to sign in.

## Run locally

Requires Node.js 22 or newer.

~~~bash
npm install
cp .env.example .env.local
npm run dev
~~~

The site has a public Supabase project URL and publishable key configured as defaults in src/lib/supabase.ts; local environment variables can override them. Preview/demo fallback is intended only for reviewing the UI and is not shared between users.

## CAPTCHA / bot protection

The login supports Cloudflare Turnstile, a low-friction CAPTCHA option supported by Supabase Auth. Supabase Auth does not natively configure Google reCAPTCHA in the same way; do not substitute a decorative checkbox for real server-verified CAPTCHA.

To activate it:
1. Create a Turnstile widget in Cloudflare for the published site hostname.
2. In Supabase Dashboard → Authentication → Protection / Bot and Abuse Protection, enable CAPTCHA, choose Cloudflare Turnstile, and enter the widget's secret key.
3. In GitHub repository Settings → Secrets and variables → Actions → Variables, add VITE_TURNSTILE_SITE_KEY with the widget's public site key. The deployment workflow passes that public key to Vite.
4. For local testing, add VITE_TURNSTILE_SITE_KEY to .env.local. The secret key belongs only in Supabase's dashboard—not in this repository or any VITE_* variable.

Until both the provider secret in Supabase and the public site key for the frontend are configured, the CAPTCHA is not active. Sign-in remains protected by Supabase authentication and row-level permissions, but bot protection is not complete.

## Existing Supabase project

The app connects to the existing Supabase project used for Ediova. The database migrations already applied to that project include:
- Row-level task access, including manager release-time restrictions.
- The recurrence fields, selected-weekday rules and hourly generator.
- Team directory and notices tables.
- Director-only task-hour targets protected by row-level security.
- Role-checked monthly performance aggregate functions and a security-invoker compatibility performance view.
- Tightened task-level comment/history policies.

Do not apply the older starter migration in supabase/migrations/202610090001_initial_schema.sql to the current database as a new schema; it predates the live schema. Use Supabase's recorded migrations and the live schema as the source of truth.

## Production verification

The current database contains the two authenticated profiles. Before relying on the workspace for operations, sign in separately with each real account in the browser and verify:
- The manager can see assigned released work only, complete tasks, add comments and open completed work.
- The director can create, edit, schedule, repeat by selected weekday, set private hour targets, reopen and assign tasks, view monthly performance, send a notice and archive it.
- Managers can see their own monthly credited hours and completed task counts, but cannot query task-specific hour targets.
- A monthly task configured for two dates generates two future occurrences per month at the configured release time.
- The Manager's performance score drops by 10 points for every full day late per task and never falls below 0.

Never publish a Supabase service-role key. Frontend Supabase keys are public; the database's RLS rules are the authorization boundary.

## Deployment

The public site is hosted on GitHub Pages:
https://linemindmap.github.io/ediova-workspace/

GitHub Actions runs npm run build (type-check + Vite build) and publishes the dist output. The Pages deployment uses GitHub Actions, not a separate Vercel deployment.

Ediova Inc.
Jl. Kaluirang 14,5
Yogyakarta, Indonesia 55584
Tel: +62 (813) 77012611
