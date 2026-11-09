import posthog from 'posthog-js';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
if (key && host) {
  posthog.init(key, {
    api_host: host,
    capture_pageview: 'history_change',
    autocapture: false,
    disable_session_recording: true,
    person_profiles: 'identified_only',
  });
}
