import type { UUID } from './ids';
import type {
  AccountState,
  ActivitySessionState,
  AssignmentState,
  CoachVerificationState,
  ConcernState,
  FeedbackDraftState,
  GuardianLinkState,
  LoopRequestState,
  NotificationJobState,
  ParentBriefState,
} from './stateMachines';
import type { FOCUS_CATEGORIES } from './constants';

/** ISO-8601 UTC timestamp string (timestamptz). */
export type Timestamp = string;

/** Age is stored as an eligibility band only; no full birth date. */
export type EligibilityBand = 'under_13' | '13_17' | '18_plus';

export type RoleKind = 'athlete' | 'guardian' | 'coach' | 'director' | 'support_admin' | 'safeguarding_owner';

export interface Profile {
  id: UUID;
  authUserId: UUID;
  displayName: string;
  locale: string;
  timezone: string;
  eligibilityBand: EligibilityBand;
  accountState: AccountState;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Athlete {
  id: UUID;
  userId: UUID;
  activationState: AccountState;
  sportPreference: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GuardianLink {
  id: UUID;
  guardianUserId: UUID | null;
  athleteId: UUID;
  inviteContactHint: string; // masked contact, e.g. "p•••@example.test"
  status: GuardianLinkState;
  verifiedBy: UUID | null;
  verifiedAt: Timestamp | null;
  verificationEvidenceRef: string | null;
  consentScope: string[];
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ConsentPurpose =
  | 'privacy_notice'
  | 'guardian_consent'
  | 'athlete_assent'
  | 'coach_sharing'
  | 'ai_processing'
  | 'voice_recording'
  | 'email_notifications'
  | 'sms_notifications';

export interface ConsentRecord {
  id: UUID;
  subjectUserId: UUID;
  actorUserId: UUID;
  purpose: ConsentPurpose;
  policyVersion: string;
  scope: string[];
  grantedAt: Timestamp;
  withdrawnAt: Timestamp | null;
  provenance: string;
}

export interface Club { id: UUID; tenantId: UUID; name: string; createdAt: Timestamp }
export interface Team { id: UUID; tenantId: UUID; clubId: UUID; name: string; timezone: string; createdAt: Timestamp }
export interface Membership {
  id: UUID;
  tenantId: UUID;
  teamId: UUID;
  userId: UUID;
  athleteId: UUID | null;
  role: 'athlete' | 'coach' | 'director';
  startsAt: Timestamp;
  endsAt: Timestamp | null;
  status: 'active' | 'ended' | 'suspended';
}

export interface ActivitySession {
  id: UUID;
  athleteId: UUID | null;
  teamId: UUID | null;
  tenantId: UUID | null;
  title: string;
  sport: string | null;
  startsAt: Timestamp;
  timezone: string;
  state: ActivitySessionState;
  reflectionDueAt: Timestamp | null;
  nextSessionAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  authorId: UUID;
  version: number;
}

export interface PromptVersion {
  id: UUID;
  templateKey: string;
  version: number;
  locale: string;
  questionWell: string;
  questionMomentBack: string;
  optionalFields: { key: 'mood' | 'support_request'; label: string }[];
  createdAt: Timestamp;
}

export interface Assignment {
  id: UUID;
  athleteId: UUID;
  sessionId: UUID;
  promptVersionId: UUID;
  dueAt: Timestamp | null;
  expected: boolean;
  state: AssignmentState;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Reflection {
  id: UUID;
  athleteId: UUID;
  assignmentId: UUID | null;
  promptVersionId: UUID;
  answerWell: string;
  answerMomentBack: string;
  supportRequest: string | null;
  mood: number | null;
  state: 'draft' | 'submitted';
  submittedAt: Timestamp | null;
  version: number;
  revisionOf: UUID | null;
  idempotencyKey: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  authorId: UUID;
}

export interface VoiceAsset {
  id: UUID;
  ownerUserId: UUID;
  reflectionId: UUID | null;
  storagePath: string;
  consentRecordId: UUID;
  retentionState: 'active' | 'delete_pending' | 'deleted';
  transcriptState: 'none' | 'draft' | 'confirmed' | 'error';
  transcriptDraft: string | null;
  transcriptSimulated: boolean;
  deletedAt: Timestamp | null;
  createdAt: Timestamp;
}

export type FocusCategory = (typeof FOCUS_CATEGORIES)[number];

export interface FocusVersion {
  id: UUID;
  focusPlanId: UUID;
  athleteId: UUID;
  now: string; // athlete's own words
  nextAction: string;
  nextSituation: string;
  nextMeasure: string;
  northStar: string | null;
  categories: FocusCategory[];
  sourceIds: UUID[];
  authorId: UUID;
  authorRole: 'athlete' | 'coach';
  changeReason: string;
  acceptedAt: Timestamp | null;
  acceptedBy: UUID | null;
  supersededAt: Timestamp | null;
  createdAt: Timestamp;
  version: number;
}

export interface CoachInvite {
  id: UUID;
  athleteId: UUID;
  coachDisplayName: string;
  intendedEmailHash: string; // hash of normalized intended email; never plaintext token
  intendedEmailHint: string;
  tokenHash: string;
  expiresAt: Timestamp;
  redeemedAt: Timestamp | null;
  redeemedBy: UUID | null;
  revokedAt: Timestamp | null;
  createdBy: UUID;
  createdAt: Timestamp;
}

export interface CoachRelationship {
  id: UUID;
  athleteId: UUID;
  coachUserId: UUID;
  inviteId: UUID | null;
  verificationState: CoachVerificationState;
  verifiedBy: UUID | null;
  verifiedAt: Timestamp | null;
  verificationEvidenceRef: string | null;
  secondAdultUserId: UUID | null;
  scope: string[];
  active: boolean;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AudienceMember {
  userId: UUID;
  displayName: string;
  role: 'athlete' | 'coach' | 'guardian' | 'second_adult';
}

export interface AudienceSnapshot {
  members: AudienceMember[];
  hash: string;
  capturedAt: Timestamp;
}

export interface LoopRequest {
  id: UUID;
  athleteId: UUID;
  reflectionId: UUID;
  sessionId: UUID | null;
  coachRelationshipId: UUID;
  sharedExcerpt: string;
  question: string;
  audience: AudienceSnapshot;
  nextSessionAt: Timestamp | null;
  dueAt: Timestamp;
  state: LoopRequestState;
  idempotencyKey: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  version: number;
}

export interface FeedbackDraft {
  id: UUID;
  requestId: UUID;
  coachId: UUID;
  summary: string;
  oneNextAction: string;
  situation: string;
  measure: string;
  aiSourceIds: UUID[];
  aiModel: string | null;
  aiPromptVersion: string | null;
  state: FeedbackDraftState;
  reviewedAudienceHash: string | null;
  reviewedVersion: number | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Private to the authoring coach; never published, never visible to athlete/guardian. */
export interface CoachNote {
  id: UUID;
  coachId: UUID;
  athleteId: UUID | null;
  teamId: UUID | null;
  body: string;
  kind: 'private_note' | 'team_transcript';
  createdAt: Timestamp;
}

export interface FeedbackPublication {
  id: UUID;
  requestId: UUID;
  athleteId: UUID;
  coachId: UUID;
  draftId: UUID;
  summary: string;
  oneNextAction: string;
  situation: string;
  measure: string;
  approvedBy: UUID;
  approvedAt: Timestamp;
  audience: AudienceSnapshot;
  correctedFromId: UUID | null;
  isCurrent: boolean;
  version: number;
  publishIdempotencyKey: string;
  createdAt: Timestamp;
}

export type SharingSurface = 'coach_request' | 'guardian_cues' | 'coach_history' | 'shared_thread';

export interface SharingGrant {
  id: UUID;
  recordType: 'reflection' | 'focus_version' | 'feedback_publication' | 'profile_snapshot';
  recordId: UUID;
  ownerAthleteId: UUID;
  recipientUserId: UUID;
  relationshipId: UUID | null;
  surface: SharingSurface;
  purpose: string;
  grantedAt: Timestamp;
  revokedAt: Timestamp | null;
}

export interface ParentBrief {
  id: UUID;
  athleteId: UUID;
  guardianLinkId: UUID;
  authorCoachId: UUID;
  somethingToSay: string;
  questionToAsk: string;
  habitToPraise: string;
  sourceIds: UUID[];
  state: ParentBriefState;
  reviewedBy: UUID | null;
  reviewedAt: Timestamp | null;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type NotificationChannel = 'in_app' | 'email' | 'sms';
export type NotificationPurpose =
  | 'reflection_reminder'
  | 'coach_request_waiting'
  | 'coach_responded'
  | 'guardian_invite'
  | 'coach_invite'
  | 'brief_published'
  | 'consent_update'
  | 'system';

export interface NotificationJob {
  id: UUID;
  recipientUserId: UUID;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  consentRecordId: UUID | null;
  dueAt: Timestamp;
  idempotencyKey: string;
  attemptCount: number;
  state: NotificationJobState;
  /** Neutral title only; never diary or coach content. */
  title: string;
  linkPath: string;
  providerMessageId: string | null;
  lastError: string | null;
  readAt: Timestamp | null;
  relatedSessionId: UUID | null;
  createdAt: Timestamp;
}

export interface NotificationPreferences {
  userId: UUID;
  inAppEnabled: boolean;
  emailReminders: boolean;
  smsReminders: false; // SMS disabled feature
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  updatedAt: Timestamp;
}

export interface Concern {
  id: UUID;
  reporterUserId: UUID;
  subjectAthleteId: UUID | null;
  subjectUserId: UUID | null;
  referenceType: string | null;
  referenceId: UUID | null;
  assignedSafeguardingOwner: UUID | null;
  severity: 'unassessed' | 'low' | 'medium' | 'high';
  state: ConcernState;
  description: string;
  evidenceRef: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuditEvent {
  id: UUID;
  actorUserId: UUID | null;
  action: string;
  targetType: string;
  targetIds: UUID[];
  purpose: string;
  audienceChange: string | null;
  correlationId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: Timestamp;
}

export interface Sponsorship {
  id: UUID;
  athleteId: UUID;
  sponsorName: string;
  startsAt: Timestamp;
  endsAt: Timestamp | null;
  status: 'active' | 'ended';
}

export interface Subscription {
  id: UUID;
  payerUserId: UUID;
  athleteId: UUID;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  lastEventCreated: number;
  currentPeriodEnd: Timestamp | null;
  updatedAt: Timestamp;
}

export interface Entitlement {
  athleteId: UUID;
  active: boolean;
  fundingSource: 'none' | 'family_subscription' | 'sponsorship';
  effectiveFrom: Timestamp | null;
  effectiveTo: Timestamp | null;
}

export interface ProfileSnapshot {
  id: UUID;
  athleteId: UUID;
  sourceRecordIds: UUID[];
  generator: 'deterministic' | 'ai_suggested';
  generatorVersion: string;
  provenance: string;
  reviewState: 'unreviewed' | 'athlete_reviewed' | 'corrected';
  content: { strengths: string[]; recurringMoments: string[] };
  createdAt: Timestamp;
}
