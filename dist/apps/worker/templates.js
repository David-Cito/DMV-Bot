"use strict";
// Message templates
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 11
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDepositNeededMessage = getDepositNeededMessage;
exports.getBookedMessage = getBookedMessage;
exports.getOpportunityPassedMessage = getOpportunityPassedMessage;
exports.logMessageWithDedupe = logMessageWithDedupe;
const db_1 = require("../../packages/db");
const HONOLULU_TZ = 'Pacific/Honolulu';
function getDepositNeededMessage() {
    return {
        type: 'deposit_needed',
        subject: 'Deposit required to activate booking',
        body: 'You are near the front of the queue. A deposit is required to hold your place and activate managed booking.\n' +
            'Pay link: https://example.com/pay\n' +
            'Once paid, we will attempt to book the earliest available appointment that matches your preferences.',
    };
}
function getBookedMessage(locationName, dateTime) {
    const formattedDate = formatHonoluluDateTime(dateTime);
    return {
        type: 'booked',
        subject: 'Appointment booked',
        body: `Your appointment is booked at ${locationName}.\n` +
            `Date and time: ${formattedDate}\n` +
            'Next steps: Bring required documents and arrive early.',
    };
}
function getOpportunityPassedMessage() {
    return {
        type: 'opportunity_passed',
        subject: 'Appointment opening missed',
        body: 'An opening appeared outside your selected availability, so we did not book it.\n' +
            'Consider widening your availability to improve your chances.\n' +
            'We will never book outside your approved preferences.',
    };
}
async function logMessageWithDedupe(customerId, template, dedupeKey) {
    return (0, db_1.insertMessageWithDedupe)({
        customerId,
        messageType: template.type,
        dedupeKey,
        metaJson: { template },
    });
}
function formatHonoluluDateTime(dateTime) {
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
//# sourceMappingURL=templates.js.map