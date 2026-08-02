// Čtecí funkce, které mimo doménu potřebuje CLI z P16 a integrační testy.
export { readCampaignStats, type CampaignStatsRead } from './campaign-stats/read';
export { readCampaignBuckets } from './campaign-stats/buckets';
export { readCampaignLinks } from './campaign-stats/links';
export { readCampaignRecipients, RECIPIENT_FILTERS } from './campaign-stats/recipients';
export {
  compareWithStored,
  recomputeCampaignCounts,
  type DriftReport,
} from './campaign-stats/recompute';
export { readCampaignProgress, bucketDrift } from './progress/read';
export { readContactTimeline } from './timeline/query';
export { readDashboard } from './dashboard/read';
export { EVENT_TYPES, type EventType } from './event-types';

// Router se schválně NEREEXPORTUJE. Cesty se importují z '@mlain/core/reports/api',
// aby si aplikace kvůli mountu netáhla celou doménu do svého grafu modulů.
