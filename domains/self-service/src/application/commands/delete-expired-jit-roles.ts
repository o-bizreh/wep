import {
  IAMClient,
  ListRolesCommand,
  DeleteRolePolicyCommand,
  DeleteRoleCommand,
  credentialStore,
  regionStore,
} from '@wep/aws-clients';

const ROLE_PREFIX = 'wep-jit-';
const BATCH_SIZE = 100;

/**
 * Scans IAM for wep-jit-* roles whose ExpiresAt tag is in the past and deletes
 * them. Runs as a background job — call execute() on a schedule.
 *
 * Each role has exactly one inline policy named WepJitInlinePolicy.
 * IAM requires the inline policy to be deleted before the role can be deleted.
 */
export class DeleteExpiredJitRolesHandler {
  private iam(): IAMClient {
    return new IAMClient({
      region: regionStore.getProvider(),
      credentials: credentialStore.getProvider(),
    });
  }

  async execute(): Promise<{ deleted: string[]; errors: string[] }> {
    const deleted: string[] = [];
    const errors: string[] = [];
    const iam = this.iam();
    const now = Date.now();

    try {
      let marker: string | undefined;
      do {
        const resp = await iam.send(new ListRolesCommand({
          PathPrefix: '/',
          MaxItems: BATCH_SIZE,
          Marker: marker,
        }));

        const expired = (resp.Roles ?? []).filter((role) => {
          if (!role.RoleName?.startsWith(ROLE_PREFIX)) return false;
          const tag = role.Tags?.find((t) => t.Key === 'ExpiresAt');
          if (!tag?.Value) return false;
          return new Date(tag.Value).getTime() <= now;
        });

        for (const role of expired) {
          const name = role.RoleName!;
          try {
            // Must delete inline policy before the role
            await iam.send(new DeleteRolePolicyCommand({ RoleName: name, PolicyName: 'WepJitInlinePolicy' }));
            await iam.send(new DeleteRoleCommand({ RoleName: name }));
            deleted.push(name);
          } catch (e) {
            errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        marker = resp.IsTruncated ? resp.Marker : undefined;
      } while (marker);
    } catch (e) {
      errors.push(`ListRoles failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { deleted, errors };
  }
}
