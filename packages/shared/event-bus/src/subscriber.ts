import { type Result, type DomainEvent, failure, domainError } from '@wep/domain-types';

export type EventHandler<T> = (event: DomainEvent<T>) => Promise<Result<void, Error>>;

export function createEventHandler<T>(handler: EventHandler<T>) {
  return async (lambdaEvent: { detail: unknown; source: string; 'detail-type': string }) => {
    const event = lambdaEvent.detail as DomainEvent<T>;

    if (!event.eventId || !event.entityId || !event.timestamp) {
      console.error('Invalid event envelope', JSON.stringify(lambdaEvent));
      return failure(domainError('INVALID_EVENT', 'Event missing required envelope fields'));
    }

    console.log(
      JSON.stringify({
        action: 'processing_event',
        eventId: event.eventId,
        entityId: event.entityId,
        source: lambdaEvent.source,
        detailType: lambdaEvent['detail-type'],
        correlationId: event.correlationId,
      }),
    );

    const result = await handler(event);

    if (!result.ok) {
      console.error(
        JSON.stringify({
          action: 'event_processing_failed',
          eventId: event.eventId,
          error: result.error.message,
        }),
      );
    }

    return result;
  };
}
