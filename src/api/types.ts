/**
 * Adapter contract between the UI and a backend. Two implementations exist and are never mixed:
 *  - DemoApi (synthetic, in-browser, no network effects, role switcher)
 *  - SupabaseApi (real auth/RLS/RPC; identity comes only from the verified JWT)
 * Every method is authorized by the backend; the UI hiding a button is never authority.
 */
import type {
  AccountState,
  ActivationGap,
  ActivitySession,
  AudienceMember,
  CoachVerificationState,
  ConsentPurpose,
  ConsentRecord,
  EligibilityBand,
  ExchangeGateFailure,
  FeedbackDraft,
  FeedbackDraftInput,
  FeedbackPublication,
  FocusProposalInput,
  FocusVersion,
  LoopLabel,
  LoopRequest,
  LoopRequestInput,
  NotificationJob,
  NotificationPreferences,
  ParentBrief,
  Reflection,
  ReflectionDraftInput,
  ReflectionSubmitInput,
  SharingGrant,
  SoloOrganized,
  AuditEvent,
  Concern,
} from '../domain';
import { fingerprint } from '../domain';

export type AdapterKind = 'demo' | 'supabase';

export interface Viewer {
  userId: string;
  displayName: string;
  eligibilityBand: EligibilityBand;
  accountState: AccountState;
  athleteId: string | null;
  isGuardian: boolean;
  isCoach: boolean;
  staffRoles: ('support_admin' | 'safeguarding_owner' | 'verification_reviewer')[];
  aal: 'aal1' | 'aal2';
}

export interface CoachSummary {
  relationshipId: string;
  coachUserId: string;
  coachName: string;
  verificationState: CoachVerificationState;
  secondAdultName: string | null;
  guardianApproved: boolean;
  active: boolean;
}

export interface InviteSummary {
  id: string;
  label: string; // coach name or "Guardian"
  hint: string;
  expiresAt: string;
  state: 'pending' | 'redeemed' | 'revoked' | 'expired';
}

export interface ActiveRequestView {
  request: LoopRequest;
  label: LoopLabel;
  coachName: string;
}

export interface AthleteHome {
  displayName: string;
  athleteId: string;
  eligibilityBand: EligibilityBand;
  nextSession: ActivitySession | null;
  openAssignmentId: string | null;
  currentFocus: FocusVersion | null;
  focusProposals: (FocusVersion & { authorName: string })[];
  latestRequest: ActiveRequestView | null;
  coaches: CoachSummary[];
  recentReflections: Reflection[];
}

export interface PendingStatus {
  displayName: string;
  gaps: ActivationGap[];
  invites: InviteSummary[];
  linkStates: { id: string; status: string; guardianName: string | null }[];
}

export interface CreatedInvite {
  inviteId: string;
  /** Simulated/copyable link. Contains only an opaque token, never diary data. */
  link: string;
  expiresAt: string;
  delivery: 'simulated_copy_link' | 'email_queued';
}

export interface AudiencePreview {
  members: AudienceMember[];
  hash: string;
  gateFailures: ExchangeGateFailure[];
}

export interface FeedbackView {
  request: LoopRequest;
  label: LoopLabel;
  coachName: string;
  coachVerified: boolean;
  publication: FeedbackPublication | null;
  history: FeedbackPublication[];
  currentFocus: FocusVersion | null;
}

export type TimelineItem =
  | { kind: 'reflection'; at: string; source: 'athlete_words'; reflection: Reflection }
  | { kind: 'feedback'; at: string; source: 'coach_observation'; publication: FeedbackPublication; coachName: string }
  | { kind: 'focus'; at: string; source: 'athlete_words' | 'coach_observation'; focus: FocusVersion; authorName: string }
  | { kind: 'request'; at: string; source: 'athlete_words'; request: LoopRequest; label: LoopLabel; coachName: string };

export interface GuardianChildView {
  athleteId: string;
  displayName: string;
  accountState: AccountState;
  linkId: string;
  linkStatus: string;
  guardianConsentGiven: boolean;
  gaps: ActivationGap[];
  focus: FocusVersion | null;
  sharedThreads: { request: LoopRequest; publication: FeedbackPublication | null; coachName: string; label: LoopLabel }[];
  briefs: ParentBrief[];
  coachesAwaitingApproval: CoachSummary[];
  coaches: CoachSummary[];
}

export interface GuardianHome {
  displayName: string;
  children: GuardianChildView[];
}

export interface CoachRequestView {
  request: LoopRequest;
  athleteName: string;
  athleteRef: string; // stable short reference derived from the athlete UUID
  athleteId: string;
  focus: FocusVersion | null;
  audience: AudiencePreview;
  draft: FeedbackDraft | null;
  publication: FeedbackPublication | null;
  label: LoopLabel;
  guardianLinks: { linkId: string; guardianName: string }[];
}

export interface CoachInbox {
  displayName: string;
  relationships: { relationshipId: string; athleteName: string; athleteRef: string; athleteId: string; verificationState: CoachVerificationState }[];
  open: CoachRequestView[];
  recent: CoachRequestView[];
  briefs: (ParentBrief & { athleteName: string })[];
}

export interface AiSuggestionResult {
  ok: boolean;
  warnings: string[];
  reason?: string;
  draft?: FeedbackDraft;
}

export interface SettingsView {
  prefs: NotificationPreferences;
  consents: ConsentRecord[];
  notifications: NotificationJob[];
  myAudit: AuditEvent[];
  deletionRequests: { id: string; scope: string; state: string; createdAt: string }[];
  shares: (SharingGrant & { recipientName: string })[];
  entitlement: { active: boolean; fundingSource: string } | null;
}

export interface QueueItem {
  kind: 'coach' | 'guardian';
  id: string;
  athleteRef: string;
  subjectName: string;
  state: string;
  guardianApproved: boolean | null;
  createdAt: string;
}

export interface AdminView {
  queue: QueueItem[];
  concerns: Concern[];
  audit: AuditEvent[];
  canReview: boolean;
  canSafeguard: boolean;
}

export interface TeamCoverageCell {
  key: string;
  label: string;
  suppressed: boolean;
  reason?: string;
  expected?: number;
  completed?: number;
  rate?: number | null;
}

export interface LoopApi {
  readonly kind: AdapterKind;
  getViewer(): Promise<Viewer | null>;
  signOut(): Promise<void>;

  // Onboarding
  startAthlete(input: { displayName: string; eligibilityBand: EligibilityBand; timezone: string }): Promise<Viewer>;
  getPendingStatus(): Promise<PendingStatus>;
  createGuardianInvite(email: string): Promise<CreatedInvite>;
  cancelGuardianInvite(inviteId: string): Promise<void>;
  recordConsent(purpose: ConsentPurpose, athleteId?: string): Promise<{ accountState: AccountState | null }>;
  withdrawConsent(consentId: string): Promise<void>;

  // Athlete
  getAthleteHome(): Promise<AthleteHome>;
  createSession(input: { title: string; sport: string | null; startsAt: string; nextSessionAt: string | null }): Promise<{ sessionId: string; assignmentId: string }>;
  cancelSession(sessionId: string): Promise<void>;
  getDraft(assignmentId: string | null): Promise<Reflection | null>;
  saveDraft(input: ReflectionDraftInput & { reflectionId: string | null; assignmentId: string | null; expectedVersion: number | null }): Promise<{ reflectionId: string; version: number }>;
  submitReflection(input: ReflectionSubmitInput & { reflectionId: string | null; assignmentId: string | null }): Promise<{ reflectionId: string; duplicate: boolean }>;
  getReflection(id: string): Promise<Reflection>;
  organizeSolo(reflectionId: string): Promise<SoloOrganized>;
  proposeFocus(input: FocusProposalInput & { athleteId: string; accept: boolean }): Promise<{ focusVersionId: string; accepted: boolean }>;
  acceptFocus(focusVersionId: string): Promise<void>;
  declineFocus(focusVersionId: string): Promise<void>;
  getTimeline(): Promise<TimelineItem[]>;
  listCoaches(): Promise<{ coaches: CoachSummary[]; invites: InviteSummary[] }>;
  createCoachInvite(input: { coachDisplayName: string; coachEmail: string }): Promise<CreatedInvite>;
  revokeCoachInvite(inviteId: string): Promise<void>;
  revokeCoach(relationshipId: string): Promise<void>;
  previewAudience(relationshipId: string): Promise<AudiencePreview>;
  createLoopRequest(input: LoopRequestInput): Promise<{ requestId: string; duplicate: boolean }>;
  cancelLoopRequest(requestId: string): Promise<void>;
  getFeedback(requestId: string): Promise<FeedbackView>;
  acknowledgeFeedback(requestId: string, close: boolean): Promise<void>;
  grantShare(input: { recordType: SharingGrant['recordType']; recordId: string; recipientUserId: string; surface: SharingGrant['surface']; purpose: string }): Promise<void>;
  revokeShare(grantId: string): Promise<void>;
  simulateVoiceTranscript(): Promise<{ transcript: string; simulated: true }>;

  // Guardian
  redeemGuardianInvite(token: string): Promise<{ linkId: string; status: string }>;
  getGuardianHome(): Promise<GuardianHome>;
  approveCoach(relationshipId: string): Promise<void>;
  revokeGuardianLink(linkId: string): Promise<void>;

  // Coach
  redeemCoachInvite(token: string): Promise<{ relationshipId: string; verificationState: CoachVerificationState }>;
  getCoachInbox(): Promise<CoachInbox>;
  getCoachRequest(requestId: string): Promise<CoachRequestView>;
  saveFeedbackDraft(requestId: string, input: FeedbackDraftInput, expectedVersion: number | null): Promise<FeedbackDraft>;
  requestAiSuggestion(requestId: string): Promise<AiSuggestionResult>;
  markReviewed(draftId: string, expectedVersion: number, audienceHash: string): Promise<FeedbackDraft>;
  publishFeedback(input: { draftId: string; draftVersion: number; confirmedAudienceHash: string; idempotencyKey: string }): Promise<{ publicationId: string; duplicate: boolean }>;
  declineRequest(requestId: string): Promise<void>;
  createBrief(input: { athleteId: string; guardianLinkId: string; somethingToSay: string; questionToAsk: string; habitToPraise: string; sourceIds: string[] }): Promise<{ briefId: string }>;
  advanceBrief(briefId: string, action: 'review' | 'publish' | 'revoke'): Promise<void>;
  getTeamCoverage(): Promise<TeamCoverageCell[]>;

  // Settings / safety / rights
  getSettings(): Promise<SettingsView>;
  updatePreferences(input: { inAppEnabled: boolean; emailReminders: boolean; quietHoursStart: number; quietHoursEnd: number }): Promise<void>;
  markNotificationRead(id: string): Promise<void>;
  exportMyData(): Promise<Record<string, unknown>>;
  requestDeletion(scope: 'account' | 'voice_only' | 'reflections'): Promise<void>;
  reportConcern(input: { description: string; subjectAthleteId: string | null; referenceType: Concern['referenceType'] | null; referenceId: string | null }): Promise<{ routed: boolean }>;
  blockUser(userId: string): Promise<void>;

  // Admin (restricted; requires staff role + aal2 server-side)
  getAdmin(): Promise<AdminView>;
  reviewCoach(relationshipId: string, decision: 'verify' | 'reject' | 'suspend' | 'reinstate', evidenceRef: string): Promise<void>;
  reviewGuardianLink(linkId: string, decision: 'verify' | 'reject', evidenceRef: string): Promise<void>;
  triageConcern(concernId: string, state: Concern['state'], severity: Concern['severity']): Promise<void>;
}

/** Stable, human-checkable reference derived from a UUID (never a name). */
export function shortRef(uuid: string): string {
  return `#${fingerprint(uuid.toLowerCase()).slice(0, 6).toUpperCase()}`;
}
