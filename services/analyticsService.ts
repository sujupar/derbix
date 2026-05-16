// Analytics service — pushes events to GTM dataLayer
// GA4 tags are configured inside GTM to listen for these events.

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

/**
 * Push a custom event to the GTM dataLayer.
 */
export function trackEvent(event: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

// ─── Specific event helpers ───

/** User viewed a SEO prediction page */
export function trackPredictionView(league: string, match: string): void {
  trackEvent('page_view_prediction', { league, match });
}

/** User clicked a register/signup CTA */
export function trackRegisterCTA(source: string): void {
  trackEvent('click_register_cta', { source });
}

/** User completed free signup */
export function trackSignupFree(): void {
  trackEvent('signup_free');
}

/**
 * User completed signup with UTM attribution + dedup eventID.
 *
 * The `eventID` is what lets Meta dedupe between the browser Pixel and the
 * server-side Conversions API. Both must send the SAME eventID for the same
 * signup. The GTM tag for `signup_free` MUST read this `eventID` from the
 * dataLayer and pass it to `fbq('track', 'CompleteRegistration', {}, {eventID})`
 * — without that, the browser fire is not dedup-eligible.
 *
 * See: https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events
 */
export function trackSignupWithAttribution(params: {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmRef?: string;
  eventID?: string;
}): void {
  trackEvent('signup_free', {
    utm_source: params.utmSource,
    utm_medium: params.utmMedium,
    utm_campaign: params.utmCampaign,
    utm_ref: params.utmRef,
    eventID: params.eventID,
  });
}

/** User attempted to view premium/blurred content */
export function trackPremiumBlurView(match: string): void {
  trackEvent('view_premium_blur', { match });
}

/** User upgraded to a premium plan */
export function trackUpgradePremium(plan: string): void {
  trackEvent('upgrade_premium', { plan });
}

/** User clicked a referral link */
export function trackReferralClick(destination: string): void {
  trackEvent('referral_click', { destination });
}

/** User downloaded a PDF report */
export function trackPDFDownload(match: string): void {
  trackEvent('pdf_download', { match });
}
