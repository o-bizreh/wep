import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';
import type { DomainEvent } from '@wep/domain-types';
import { getBusName } from '@wep/aws-clients';

export class EventPublisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly busName: string = getBusName(),
  ) {}

  async publish<T>(
    source: string,
    detailType: string,
    event: DomainEvent<T>,
  ): Promise<Result<void, DomainError>> {
    try {
      const response = await this.client.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: this.busName,
              Source: source,
              DetailType: detailType,
              Detail: JSON.stringify(event),
              Time: new Date(event.timestamp),
            },
          ],
        }),
      );

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const failedEntry = response.Entries?.[0];
        return failure(
          domainError('EVENT_PUBLISH_FAILED', `Failed to publish ${detailType}`, {
            errorCode: failedEntry?.ErrorCode,
            errorMessage: failedEntry?.ErrorMessage,
          }),
        );
      }

      return success(undefined);
    } catch (error) {
      return failure(
        domainError('EVENT_PUBLISH_FAILED', `Failed to publish ${detailType}`, {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async publishBatch<T>(
    source: string,
    events: Array<{ detailType: string; event: DomainEvent<T> }>,
  ): Promise<Result<void, DomainError>> {
    const entries = events.map(({ detailType, event }) => ({
      EventBusName: this.busName,
      Source: source,
      DetailType: detailType,
      Detail: JSON.stringify(event),
      Time: new Date(event.timestamp),
    }));

    try {
      const response = await this.client.send(new PutEventsCommand({ Entries: entries }));

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        return failure(
          domainError('EVENT_PUBLISH_FAILED', `${response.FailedEntryCount} events failed`),
        );
      }

      return success(undefined);
    } catch (error) {
      return failure(
        domainError('EVENT_PUBLISH_FAILED', 'Batch publish failed', {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
