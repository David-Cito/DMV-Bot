// Message templates
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 11

import type { MessageLogEntry, MessageType } from '../../packages/core';
import { insertMessageWithDedupe } from '../../packages/db';

export interface MessageTemplate {
  type: MessageType;
  subject?: string;
  body: string;
}

const HONOLULU_TZ = 'Pacific/Honolulu';

export function getDepositNeededMessage(): MessageTemplate {
  return {
    type: 'deposit_needed',
    subject: 'Deposit required to activate booking',
    body:
      'You are near the front of the queue. A deposit is required to hold your place and activate managed booking.\n' +
      'Pay link: https://example.com/pay\n' +
      'Once paid, we will attempt to book the earliest available appointment that matches your preferences.',
  };
}

export function getBookedMessage(locationName: string, dateTime: Date): MessageTemplate {
  const formattedDate = formatHonoluluDateTime(dateTime);
  return {
    type: 'booked',
    subject: 'Appointment booked',
    body:
      `Your appointment is booked at ${locationName}.\n` +
      `Date and time: ${formattedDate}\n` +
      'Next steps: Bring required documents and arrive early.',
  };
}

export function getOpportunityPassedMessage(): MessageTemplate {
  return {
    type: 'opportunity_passed',
    subject: 'Appointment opening missed',
    body:
      'An opening appeared outside your selected availability, so we did not book it.\n' +
      'Consider widening your availability to improve your chances.\n' +
      'We will never book outside your approved preferences.',
  };
}

export async function logMessageWithDedupe(
  customerId: string,
  template: MessageTemplate,
  dedupeKey: string
): Promise<MessageLogEntry | null> {
  return insertMessageWithDedupe({
    customerId,
    messageType: template.type,
    dedupeKey,
    metaJson: { template },
  });
}

function formatHonoluluDateTime(dateTime: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: HONOLULU_TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${formatter.format(dateTime)} HST`;
}

