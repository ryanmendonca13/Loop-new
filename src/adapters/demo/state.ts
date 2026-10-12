import type {
  ActivitySession,
  Assignment,
  Athlete,
  AuditEvent,
  CoachInvite,
  CoachNote,
  CoachRelationship,
  Concern,
  ConsentRecord,
  EligibilityBand,
  FeedbackDraft,
  FeedbackPublication,
  FocusVersion,
  GuardianLink,
  LoopRequest,
  Membership,
  NotificationJob,
  NotificationPreferences,
  ParentBrief,
  PromptVersion,
  Reflection,
  SharingGrant,
  Sponsorship,
  Subscription,
  Team,
  VoiceAsset,
  AccountState,
} from '../../domain';

export interface DemoUser {
  id: string;
  email: string; // fictional .example.test addresses only
  displayName: string;
  band: EligibilityBand;
  accountState: AccountState;
  timezone: string;
  staffRoles: ('support_admin' | 'safeguarding_owner' | 'verification_reviewer')[];
  /** Short persona description for the demo role switcher. */
  persona: string;
}

export type DemoCoachRelationship = CoachRelationship & {
  athleteConfirmedAt: string | null;
  guardianApprovedAt: string | null;
  guardianApprovedBy: string | null;
};

export type DemoGuardianInvite = Omit<CoachInvite, 'coachDisplayName'>;

export interface DemoState {
  schemaVersion: 3;
  users: DemoUser[];
  athletes: Athlete[];
  guardianInvites: DemoGuardianInvite[];
  guardianLinks: GuardianLink[];
  consents: ConsentRecord[];
  sessions: ActivitySession[];
  promptVersions: PromptVersion[];
  assignments: Assignment[];
  reflections: Reflection[];
  voiceAssets: VoiceAsset[];
  focusVersions: (FocusVersion & { declinedAt: string | null })[];
  coachInvites: CoachInvite[];
  coachRelationships: DemoCoachRelationship[];
  loopRequests: LoopRequest[];
  drafts: FeedbackDraft[];
  coachNotes: CoachNote[];
  publications: FeedbackPublication[];
  grants: SharingGrant[];
  briefs: ParentBrief[];
  prefs: NotificationPreferences[];
  notifications: NotificationJob[];
  concerns: Concern[];
  blocks: { blockerUserId: string; blockedUserId: string; createdAt: string }[];
  audit: AuditEvent[];
  deletionRequests: { id: string; subjectUserId: string; scope: string; state: string; createdAt: string }[];
  sponsorships: Sponsorship[];
  subscriptions: Subscription[];
  teams: Team[];
  memberships: Membership[];
  rateHits: Record<string, string[]>;
  aiCalls: { at: string; actor: string; outcome: string }[];
}
