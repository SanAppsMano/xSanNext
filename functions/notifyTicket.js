import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:example@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function notifyTicket(subscription, ticket) {
  if (!subscription) return;
  const payload = JSON.stringify({
    title: 'Sua vez!',
    body: `Ticket ${ticket} chamado`,
    sound: 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg'
  });
  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    console.error('notifyTicket', err);
  }
}
