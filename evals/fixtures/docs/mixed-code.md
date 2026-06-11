# Worker Queue Integration Guide

## Background

It is important to note that all background work in this project flows through a single queue abstraction. The reason for this is essentially historical: we used to have three different queueing mechanisms, and as a result, debugging production incidents required engineers to understand all three of them. We consolidated everything in order to reduce that operational burden, and going forward, every new job type should use the shared abstraction that is described in this document.

## Defining a Job

In order to define a new job, you will need to create a class that extends the base job type and registers itself with the queue registry. It is generally a good idea to keep the payload as small as possible, because the payload is serialized into Redis and large payloads have a tendency to degrade the performance of the entire queue.

```typescript
import { Job, registerJob } from '../queue/registry';

interface SendWelcomeEmailPayload {
  userId: string;
  templateId: string;
  locale?: string;
}

@registerJob('send-welcome-email')
export class SendWelcomeEmailJob extends Job<SendWelcomeEmailPayload> {
  async handle({ userId, templateId, locale }: SendWelcomeEmailPayload): Promise<void> {
    const user = await this.services.users.findById(userId);
    if (!user) throw new Error(`User not found: ${userId}`);
    await this.services.mailer.send(templateId, user.email, { locale: locale ?? 'en' });
  }
}
```

You should also keep in mind that the handler must be idempotent, due to the fact that the queue guarantees at-least-once delivery rather than exactly-once delivery. In the event that a worker crashes after processing a job but before acknowledging it, the job will be delivered again to another worker.

## Retry Configuration

Each and every job type is able to declare its own retry policy. In most cases, the default policy of 3 attempts with exponential backoff is perfectly adequate, but jobs that interact with rate-limited third-party APIs will generally need a more conservative configuration.

```typescript
@registerJob('sync-crm-contact', {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
})
export class SyncCrmContactJob extends Job<SyncCrmContactPayload> {
  // handler omitted for brevity
}
```

It is worth noting that the `removeOnComplete` option controls how many completed job records are retained for inspection in the dashboard. Setting this value too high will cause Redis memory usage to grow without bound over time, and setting it too low will make it very difficult to debug issues that are reported more than a few hours after they actually occurred.

## Monitoring and Alerting

The queue dashboard is available at `/admin/queues` in every environment. The dashboard shows the depth of each queue, the failure rate over the last hour, and the age of the oldest pending job. In addition to the dashboard, there are automated alerts that fire in the event that any queue depth exceeds 10000 jobs or the oldest pending job is more than 15 minutes old.

When an alert fires, the first thing that you should do is check whether the workers are actually running. The most common cause of queue depth alerts is, in actual fact, a worker deployment that failed silently, leaving the queue without any consumers at all.

```bash
kubectl get pods -l app=queue-worker -n production
kubectl logs -l app=queue-worker -n production --tail=100
```

In the event that the workers are running but the queue is still growing, the problem is generally a downstream dependency that is responding slowly, and in that case you should consult the runbook for the specific job type that is accumulating.
