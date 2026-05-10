import {
  type Result,
  success,
  failure,
  domainError,
  VelocityErrorCode,
  type DomainError,
} from '@wep/domain-types';

const MINIMUM_TEAM_SIZE = 3;

export function enforceMinimumTeamSize(
  teamId: string,
  memberCount: number,
): Result<void, DomainError<typeof VelocityErrorCode.TEAM_TOO_SMALL>> {
  if (memberCount < MINIMUM_TEAM_SIZE) {
    return failure(
      domainError(
        VelocityErrorCode.TEAM_TOO_SMALL,
        `Metric granularity too fine — minimum team size for standalone metrics is ${MINIMUM_TEAM_SIZE} members. View the parent domain's metrics instead.`,
        { teamId, memberCount, minimumRequired: MINIMUM_TEAM_SIZE },
      ),
    );
  }
  return success(undefined);
}
