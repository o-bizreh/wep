import type { Operation } from '../../domain/entities/operation.js';
import type { ServiceRequest } from '../../domain/entities/service-request.js';
import type { AutoApprovalRule } from '../../domain/value-objects/auto-approval-rule.js';
import type { RequesterContext } from './requester-context-service.js';
import type { ResourceTagResolver } from './resource-tag-resolver.js';

export interface AutoApprovalDecision {
  matched: boolean;
  rule?: AutoApprovalRule;
  /** When matched=false but a rule almost matched, this explains why so admins can debug. */
  rejectionReason?: string;
}

export interface ActiveSessionsCounter {
  countActive(requesterArn: string, operationId: string): Promise<number>;
}

/**
 * Pure-ish decision logic. Reads from injected resolvers (resource tags,
 * active-session counter) but does not write or call AWS directly.
 */
export class AutoApprovalEvaluator {
  constructor(
    private readonly counter?: ActiveSessionsCounter,
    private readonly tagResolver?: ResourceTagResolver,
  ) {}

  async evaluate(operation: Operation, request: ServiceRequest, ctx: RequesterContext): Promise<AutoApprovalDecision> {
    const cfg = operation.autoApproval;
    if (!cfg?.enabled) return { matched: false };
    if (!cfg.rules?.length) return { matched: false };

    let lastReject: string | undefined;
    for (const rule of cfg.rules) {
      const matchReason = await this.matchPasses(rule, operation, request, ctx);
      if (matchReason !== null) {
        lastReject = `match: ${matchReason}`;
        continue;
      }
      const constraintFail = await constraintsFailReason(rule, request, ctx, this.counter, operation.operationId);
      if (constraintFail) {
        lastReject = `constraint: ${constraintFail}`;
        continue;
      }
      return { matched: true, rule };
    }
    return { matched: false, rejectionReason: lastReject };
  }

  /** Returns null if the rule's match clause is satisfied; otherwise a reason string for debugging. */
  private async matchPasses(rule: AutoApprovalRule, operation: Operation, request: ServiceRequest, ctx: RequesterContext): Promise<string | null> {
    const m = rule.match;

    if (m.requesterDomain && m.requesterDomain.length > 0) {
      if (!ctx.domain || !m.requesterDomain.includes(ctx.domain)) return 'requesterDomain';
    }
    if (m.requesterTeamId && m.requesterTeamId.length > 0) {
      if (!ctx.teamIds.some((t) => m.requesterTeamId!.includes(t))) return 'requesterTeamId';
    }
    if (m.requesterDepartment && m.requesterDepartment.length > 0) {
      if (!ctx.department || !m.requesterDepartment.includes(ctx.department)) return 'requesterDepartment';
    }
    if (m.requesterUserType && m.requesterUserType.length > 0) {
      if (!ctx.userType || !m.requesterUserType.includes(ctx.userType)) return 'requesterUserType';
    }
    if (m.parameterEquals) {
      for (const [key, expected] of Object.entries(m.parameterEquals)) {
        const actual = request.parameters[key];
        if (actual === undefined) return `parameterEquals(${key} undefined)`;
        if (Array.isArray(expected)) {
          if (!expected.includes(actual)) return `parameterEquals(${key})`;
        } else {
          if (actual !== expected) return `parameterEquals(${key})`;
        }
      }
    }
    if (m.resourceOwnerTagEquals !== undefined) {
      const arnParam = operation.awsAction?.resourceArnParameter;
      if (!arnParam) return 'resourceOwnerTagEquals(no resourceArnParameter on operation)';
      const arn = request.parameters[arnParam];
      if (!arn) return `resourceOwnerTagEquals(parameter ${arnParam} missing)`;
      if (!this.tagResolver) return 'resourceOwnerTagEquals(no tag resolver wired)';
      const tagKey = m.resourceOwnerTagKey ?? 'Owner';
      const tags = await this.tagResolver.getTags(arn);
      const actual = tags[tagKey];
      if (!actual) return `resourceOwnerTagEquals(${tagKey} not on resource)`;
      const expected = m.resourceOwnerTagEquals === '$requesterDepartment'
        ? (ctx.department ?? '')
        : m.resourceOwnerTagEquals;
      if (!expected) return `resourceOwnerTagEquals($requesterDepartment unresolved)`;
      // Case-insensitive match — Identity Center tends to lowercase, AWS console tends to title-case.
      if (actual.toLowerCase() !== expected.toLowerCase()) {
        return `resourceOwnerTagEquals(${tagKey}=${actual} ≠ ${expected})`;
      }
    }
    return null;
  }
}

async function constraintsFailReason(
  rule: AutoApprovalRule,
  request: ServiceRequest,
  ctx: RequesterContext,
  counter: ActiveSessionsCounter | undefined,
  operationId: string,
): Promise<string | null> {
  const c = rule.constraints;
  if (!c) return null;

  if (c.maxDurationMinutes !== undefined) {
    const requested = request.durationMinutes ?? Infinity;
    if (requested > c.maxDurationMinutes) {
      return `duration ${requested}m exceeds rule cap ${c.maxDurationMinutes}m`;
    }
  }

  if (c.workingHoursOnly) {
    const now = new Date();
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return 'weekend';
    const hour = now.getUTCHours();
    if (hour < 9 || hour >= 18) return 'outside business hours';
  }

  if (c.excludeRequesterIds?.includes(ctx.requesterArn)) {
    return `requester is on the rule's exclude list`;
  }

  if (c.maxConcurrentSessionsForRequester !== undefined && counter) {
    const active = await counter.countActive(ctx.requesterArn, operationId);
    if (active >= c.maxConcurrentSessionsForRequester) {
      return `requester already has ${active} active sessions (cap ${c.maxConcurrentSessionsForRequester})`;
    }
  }

  return null;
}
